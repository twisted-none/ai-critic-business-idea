import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import test from 'node:test';

const listen = (server) => new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const idea = 'Сервис помогает начинающим предпринимателям проверить идею перед питчингом на стадии прототипа.';

async function startApp(t, modelResult, extraEnv = {}) {
  let calls = 0;
  let requestBody = '';
  const mock = createServer((req, res) => {
    calls += 1;
    req.on('data', (chunk) => { requestBody += chunk; });
    req.on('end', () => {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ choices: [{ message: { content: modelResult } }] }));
    });
  });
  await listen(mock);
  t.after(() => mock.close());

  const probe = createServer();
  await listen(probe);
  const appPort = probe.address().port;
  await new Promise((resolve) => probe.close(resolve));
  const app = spawn(process.execPath, ['index.js'], {
    env: {
      ...process.env,
      PORT: String(appPort),
      LLM_API_KEY: 'test-key',
      LLM_BASE_URL: `http://127.0.0.1:${mock.address().port}`,
      LLM_MODEL: 'test-model',
      ...extraEnv,
    },
    stdio: 'ignore',
  });
  t.after(() => app.kill());

  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      if ((await fetch(`http://127.0.0.1:${appPort}/health`)).ok) break;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return {
    baseUrl: `http://127.0.0.1:${appPort}`,
    calls: () => calls,
    requestBody: () => requestBody,
  };
}

const postIdea = (baseUrl, value = idea) => fetch(`${baseUrl}/api/analyze`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ idea: value }),
});

test('sends the final guarded prompt and returns an analysis', async (t) => {
  const result = {
    status: 'analysis', summary: 'Summary',
    strengths: ['S1', 'S2', 'S3'], weaknesses: ['W1', 'W2', 'W3'],
    questions: ['Q1', 'Q2', 'Q3'], next_step: 'Next step',
  };
  const app = await startApp(t, JSON.stringify(result));
  const response = await postIdea(app.baseUrl);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), result);
  const prompt = JSON.parse(app.requestBody()).messages[0].content;
  assert.match(prompt, /clarification/);
  assert.match(prompt, /handoff/);
  assert.match(prompt, /next_step/);
});

test('accepts a clarification response', async (t) => {
  const clarification = {
    status: 'clarification', summary: 'Нужны данные', strengths: [], weaknesses: [],
    questions: ['Кто пользователь?', 'Какую проблему решает продукт?'], next_step: 'Дополните описание',
  };
  const app = await startApp(t, JSON.stringify(clarification));
  const response = await postIdea(app.baseUrl);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), clarification);
});

test('accepts a handoff response for professional advice', async (t) => {
  const handoff = {
    status: 'handoff', summary: 'Нужна профессиональная оценка',
    strengths: [], weaknesses: [], questions: [],
    next_step: 'Обратитесь к корпоративному юристу.',
  };
  const app = await startApp(t, JSON.stringify(handoff));
  const response = await postIdea(app.baseUrl);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), handoff);
});

test('rejects malformed model output with a generic gateway error', async (t) => {
  const app = await startApp(t, JSON.stringify({ status: 'analysis', strengths: ['only one'] }));
  const response = await postIdea(app.baseUrl);
  assert.equal(response.status, 502);
  assert.deepEqual(await response.json(), { error: 'Не удалось получить разбор. Попробуйте ещё раз.' });
});

test('validates input length before calling the model', async (t) => {
  const app = await startApp(t, '{}');
  const shortResponse = await postIdea(app.baseUrl, 'Слишком коротко');
  const longResponse = await postIdea(app.baseUrl, 'Я'.repeat(4001));
  assert.equal(shortResponse.status, 422);
  assert.equal(longResponse.status, 422);
  assert.equal(app.calls(), 0);
});

test('sets browser security headers and hides Express', async (t) => {
  const app = await startApp(t, '{}');
  const response = await fetch(`${app.baseUrl}/`);
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-security-policy'), /default-src 'self'/);
  assert.equal(response.headers.get('x-frame-options'), 'DENY');
  assert.equal(response.headers.get('x-powered-by'), null);
});

test('disables demo mode in production', async (t) => {
  const app = await startApp(t, '{}', { NODE_ENV: 'production', DEMO_MODE: 'true', LLM_API_KEY: '' });
  const health = await fetch(`${app.baseUrl}/health`).then((response) => response.json());
  const response = await postIdea(app.baseUrl);
  assert.equal(health.demoMode, false);
  assert.equal(response.status, 503);
});

test('returns the current response contract in local demo mode', async (t) => {
  const app = await startApp(t, '{}', { NODE_ENV: 'development', DEMO_MODE: 'true', LLM_API_KEY: '' });
  const response = await postIdea(app.baseUrl);
  const result = await response.json();
  assert.equal(response.status, 200);
  assert.equal(result.status, 'analysis');
  assert.equal(result.strengths.length, 3);
  assert.equal(result.weaknesses.length, 3);
  assert.equal(result.questions.length, 3);
  assert.equal(typeof result.next_step, 'string');
});

test('rate limits repeated analysis requests', async (t) => {
  const result = JSON.stringify({
    status: 'analysis', summary: 'Summary',
    strengths: ['S1', 'S2', 'S3'], weaknesses: ['W1', 'W2', 'W3'],
    questions: ['Q1', 'Q2', 'Q3'], next_step: 'Next step',
  });
  const app = await startApp(t, result);
  const responses = [];
  for (let index = 0; index < 9; index += 1) responses.push(await postIdea(app.baseUrl));
  assert.equal(responses.at(-1).status, 429);
  assert.equal(app.calls(), 8);
});
