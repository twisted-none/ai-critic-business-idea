import express from 'express';
import OpenAI from 'openai';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const app = express();
const ROOT_DIR = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = join(ROOT_DIR, 'public');
app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(express.json({ limit: '20kb' }));

const MODEL = process.env.LLM_MODEL || 'openrouter/free';
const IS_PRODUCTION = process.env.NODE_ENV === 'production';
const DEMO_MODE = !IS_PRODUCTION && process.env.DEMO_MODE === 'true';
const API_KEY = process.env.LLM_API_KEY;
const client = API_KEY
  ? new OpenAI({
      apiKey: API_KEY,
      baseURL: process.env.LLM_BASE_URL || 'https://openrouter.ai/api/v1',
      timeout: 45_000,
      maxRetries: 1,
    })
  : null;

const SYSTEM_PROMPT = readFileSync(new URL('./system-prompt.txt', import.meta.url), 'utf8');
const RATE_LIMIT = 8;
const RATE_WINDOW_MS = 60_000;
const requestBuckets = new Map();
const cleanupTimer = setInterval(() => {
  const now = Date.now();
  for (const [ip, bucket] of requestBuckets) {
    if (now >= bucket.resetAt) requestBuckets.delete(ip);
  }
}, RATE_WINDOW_MS);
cleanupTimer.unref();

app.use((req, res, next) => {
  res.set({
    'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
  });
  if (IS_PRODUCTION) {
    res.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  next();
});
app.use(express.static(PUBLIC_DIR, { index: false, maxAge: IS_PRODUCTION ? '1h' : 0 }));

function consumeRateLimit(ip) {
  const now = Date.now();
  const bucket = requestBuckets.get(ip);
  if (!bucket || now >= bucket.resetAt) {
    requestBuckets.set(ip, { count: 1, resetAt: now + RATE_WINDOW_MS });
    return true;
  }
  if (bucket.count >= RATE_LIMIT) return false;
  bucket.count += 1;
  return true;
}

function normalizeStringArray(value) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item) => typeof item === 'string' && item.trim())
    .map((item) => item.trim());
}

function normalizeResult(result) {
  if (!result || !['analysis', 'clarification', 'handoff'].includes(result.status)) return null;
  if (typeof result.summary !== 'string' || !result.summary.trim()) return null;
  if (typeof result.next_step !== 'string' || !result.next_step.trim()) return null;
  const normalized = {
    status: result.status,
    summary: result.summary.trim(),
    strengths: normalizeStringArray(result.strengths),
    weaknesses: normalizeStringArray(result.weaknesses),
    questions: normalizeStringArray(result.questions),
    next_step: result.next_step.trim(),
  };
  if (result.status === 'analysis') {
    if (normalized.strengths.length < 3
      || normalized.weaknesses.length < 3
      || normalized.questions.length < 3) return null;
    normalized.strengths = normalized.strengths.slice(0, 3);
    normalized.weaknesses = normalized.weaknesses.slice(0, 3);
    normalized.questions = normalized.questions.slice(0, 3);
    return normalized;
  }
  if (result.status === 'clarification') {
    if (normalized.questions.length < 1) return null;
    normalized.strengths = [];
    normalized.weaknesses = [];
    normalized.questions = normalized.questions.slice(0, 3);
    return normalized;
  }
  normalized.strengths = [];
  normalized.weaknesses = [];
  normalized.questions = [];
  return normalized;
}

function parseModelResult(content) {
  const cleanContent = content
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '');
  return normalizeResult(JSON.parse(cleanContent || '{}'));
}

function buildClarificationFallback(idea) {
  const missingContextSignal = /(?:не\s+(?:определил|определена|определено|знаю|понимаю)|пока\s+нет|нет\s+данных|неясно)/i;
  if (!missingContextSignal.test(idea)) return null;
  return {
    status: 'clarification',
    summary: 'Для содержательного разбора не хватает ключевых данных об идее.',
    strengths: [],
    weaknesses: [],
    questions: [
      'Кто основной пользователь продукта?',
      'Какую конкретную проблему он должен решать?',
      'Какой измеримый результат должен получить пользователь?',
    ],
    next_step: 'Дополните описание ответами на эти вопросы и отправьте его повторно.',
  };
}

app.get('/', (_req, res) => {
  res.sendFile(join(PUBLIC_DIR, 'index.html'));
});

app.get('/demo', (_req, res) => {
  res.redirect(308, '/');
});

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', apiConfigured: Boolean(client), demoMode: DEMO_MODE });
});

app.post('/api/analyze', async (req, res) => {
  try {
    const idea = String(req.body?.idea || '').trim();
    if (idea.length < 40 || idea.length > 4000) {
      return res.status(422).json({
        error: 'Описание должно содержать от 40 до 4000 символов.',
      });
    }
    if (!consumeRateLimit(req.ip)) {
      return res.status(429).json({
        error: 'Слишком много запросов. Подождите минуту и попробуйте снова.',
      });
    }

    const clarificationFallback = buildClarificationFallback(idea);
    if (clarificationFallback) return res.json(clarificationFallback);

    if (DEMO_MODE) {
      return res.json({
        status: 'analysis',
        summary: 'Идея решает понятную задачу, но ценность и спрос ещё нужно подтвердить.',
        strengths: [
          'Понятная ценность: пользователь быстро получает взгляд инвестора на идею.',
          'MVP можно проверить без сложной разработки через лендинг и AI-анализ.',
          'Результат сразу применим: список вопросов и рисков помогает доработать презентацию.',
        ],
        weaknesses: [
          'Нет проверки фактического спроса на реальной аудитории.',
          'ИИ может давать общий разбор, если пользователь плохо описал идею.',
          'Без сохранения результатов сложно оценить повторную пользу сервиса.',
        ],
        questions: [
          'Кто конкретно целевая аудитория и насколько часто у неё возникает такая задача?',
          'Какой показатель докажет, что разбор действительно помогает перед презентацией?',
          'Почему пользователь выберет этот сервис вместо консультации с экспертом или обычного чата с ИИ?',
        ],
        next_step: 'Проведите пять интервью с представителями целевой аудитории и проверьте, помогает ли разбор улучшить презентацию.',
      });
    }

    if (!client) {
      return res.status(503).json({
        error: 'LLM API не настроен: добавьте переменную LLM_API_KEY на сервере.',
      });
    }

    const response = await client.chat.completions.create({
      model: MODEL,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: idea },
      ],
      response_format: { type: 'json_object' },
      temperature: 0.5,
      max_tokens: 900,
    });

    let result = null;
    try {
      result = parseModelResult(response.choices[0]?.message?.content || '{}');
    } catch {}
    if (!result) {
      throw new Error('LLM вернула ответ неверного формата');
    }

    res.json(result);
  } catch (error) {
    console.error('LLM request failed', { name: error?.name, status: error?.status });
    res.status(502).json({ error: 'Не удалось получить разбор. Попробуйте ещё раз.' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`AI-критик готов на порту ${PORT}`));
