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

function isStringArray(value, length = null) {
  return Array.isArray(value)
    && (length === null || value.length === length)
    && value.every((item) => typeof item === 'string' && item.trim().length > 0);
}

function isValidResult(result) {
  if (!result || !['analysis', 'clarification', 'handoff'].includes(result.status)) return false;
  if (typeof result.summary !== 'string' || !result.summary.trim()) return false;
  if (typeof result.next_step !== 'string' || !result.next_step.trim()) return false;
  if (result.status === 'analysis') {
    return isStringArray(result.strengths, 3)
      && isStringArray(result.weaknesses, 3)
      && isStringArray(result.questions, 3);
  }
  if (result.status === 'clarification') {
    return isStringArray(result.strengths, 0)
      && isStringArray(result.weaknesses, 0)
      && isStringArray(result.questions)
      && result.questions.length >= 1
      && result.questions.length <= 3;
  }
  return isStringArray(result.strengths, 0)
    && isStringArray(result.weaknesses, 0)
    && isStringArray(result.questions, 0);
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

    if (DEMO_MODE) {
      return res.json({
        status: 'analysis',
        summary: 'Идея решает понятную задачу, но ценность и спрос ещё нужно подтвердить.',
        strengths: [
          'Понятная ценность: пользователь быстро получает взгляд инвестора на идею.',
          'MVP можно проверить без сложной разработки через лендинг и AI-анализ.',
          'Результат сразу применим: список вопросов и рисков помогает доработать питч.',
        ],
        weaknesses: [
          'Нет проверки фактического спроса на реальной аудитории.',
          'ИИ может давать общий разбор, если пользователь плохо описал идею.',
          'Без сохранения результатов сложно оценить повторную пользу сервиса.',
        ],
        questions: [
          'Кто конкретно целевая аудитория и насколько часто у неё возникает такая задача?',
          'Какой показатель докажет, что разбор действительно помогает перед питчингом?',
          'Почему пользователь выберет этот сервис вместо консультации с экспертом или обычного чата с ИИ?',
        ],
        next_step: 'Проведите пять интервью с представителями целевой аудитории и проверьте, помогает ли разбор улучшить питч.',
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

    const result = JSON.parse(response.choices[0]?.message?.content || '{}');
    if (!isValidResult(result)) {
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
