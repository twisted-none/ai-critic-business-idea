import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import test from 'node:test';

const listen = (server) => new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));

test('API forwards the idea to an OpenAI-compatible LLM', async (t) => {
  let requestReceived = false;
  const mock = createServer((req, res) => {
    requestReceived = req.url === '/chat/completions';
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify({
      strengths: ['S1'], weaknesses: ['W1'], questions: ['Q1'],
    }) } }] }));
  });
  await listen(mock);
  t.after(() => mock.close());

  const probe = createServer();
  await listen(probe);
  const appPort = probe.address().port;
  await new Promise((resolve) => probe.close(resolve));
  const llmPort = mock.address().port;
  const app = spawn(process.execPath, ['index.js'], {
    env: { ...process.env, PORT: String(appPort), LLM_API_KEY: 'test-key',
      LLM_BASE_URL: `http://127.0.0.1:${llmPort}`, LLM_MODEL: 'test-model' },
    stdio: 'ignore',
  });
  t.after(() => app.kill());

  for (let i = 0; i < 30; i += 1) {
    try { if ((await fetch(`http://127.0.0.1:${appPort}/health`)).ok) break; } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  const response = await fetch(`http://127.0.0.1:${appPort}/api/analyze`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ idea: 'Подробное описание тестовой бизнес-идеи.' }),
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { strengths: ['S1'], weaknesses: ['W1'], questions: ['Q1'] });
  assert.equal(requestReceived, true);
});
