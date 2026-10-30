import express from 'express';
import OpenAI from 'openai';

const app = express();
app.use(express.json({ limit: '20kb' }));

const MODEL = process.env.LLM_MODEL || 'openrouter/free';
const DEMO_MODE = process.env.DEMO_MODE === 'true';
const API_KEY = process.env.LLM_API_KEY;
const client = API_KEY
  ? new OpenAI({
      apiKey: API_KEY,
      baseURL: process.env.LLM_BASE_URL || 'https://openrouter.ai/api/v1',
      timeout: 45_000,
      maxRetries: 1,
    })
  : null;

const SYSTEM_PROMPT = `Ты — венчурный инвестор с опытом.
Анализируй бизнес-идеи профессионально, по существу, без подбадривания и без излишней резкости.
Всегда отвечай только на русском языке.
Не выдумывай факты о рынке, выручке, конкурентах или инвестициях, если их нет в описании идеи.
Верни ответ строго в формате JSON:
{
  "strengths": ["сильная сторона 1", "сильная сторона 2", "сильная сторона 3"],
  "weaknesses": ["слабое место 1", "слабое место 2", "слабое место 3"],
  "questions": ["вопрос инвестора 1", "вопрос инвестора 2", "вопрос инвестора 3"]
}
По 3 пункта в каждом массиве. Никакого текста до или после JSON.`;

app.get('/', (_req, res) => {
  res.sendFile(new URL('./local-demo.html', import.meta.url).pathname);
});

app.get('/demo', (_req, res) => {
  res.sendFile(new URL('./local-demo.html', import.meta.url).pathname);
});

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', apiConfigured: Boolean(client), demoMode: DEMO_MODE });
});

app.post('/api/analyze', async (req, res) => {
  try {
    const idea = String(req.body?.idea || '').trim();
    if (idea.length < 20) {
      return res.status(400).json({ error: 'Опишите идею хотя бы парой предложений.' });
    }

    if (DEMO_MODE) {
      return res.json({
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
    const fields = ['strengths', 'weaknesses', 'questions'];
    if (!fields.every((field) =>
      Array.isArray(result[field]) && result[field].every((item) => typeof item === 'string')
    )) {
      throw new Error('LLM вернула ответ неверного формата');
    }

    res.json(result);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Не удалось получить разбор. Попробуйте ещё раз.' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`AI-критик готов на порту ${PORT}`));
