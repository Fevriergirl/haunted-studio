import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { OpenAIProvider } from '../src/providers/openai-provider.js';

test('OpenAI provider fails clearly when the API key is missing', () => {
  assert.throws(
    () => new OpenAIProvider({ apiKey: '', baseUrl: 'https://api.example/v1', textModel: 'test-model', imageModel: 'test-image' }),
    /OPENAI_API_KEY is required/
  );
});

test('OpenAI provider parses JSON text responses', async (context) => {
  const originalFetch = global.fetch;
  context.after(() => { global.fetch = originalFetch; });
  global.fetch = async (url, request) => {
    assert.match(url, /\/responses$/);
    assert.match(request.headers.Authorization, /^Bearer /);
    return new Response(JSON.stringify({
      output_text: JSON.stringify({
        observation: { id: 'obs', text: 'test' },
        score: 0.8,
        reasons: ['reason'],
        alternatives: []
      })
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  const provider = new OpenAIProvider({ apiKey: 'test', baseUrl: 'https://api.example/v1', textModel: 'test-model', imageModel: 'test-image' });
  const result = await provider.selectObservation({ observations: [], state: {} });
  assert.equal(result.score, 0.8);
});

test('OpenAI provider decodes a generated image', async (context) => {
  const originalFetch = global.fetch;
  context.after(() => { global.fetch = originalFetch; });
  const expected = Buffer.from('fake-png-data');
  global.fetch = async () => new Response(JSON.stringify({ data: [{ b64_json: expected.toString('base64') }] }), { status: 200 });
  const directory = await mkdtemp(path.join(os.tmpdir(), 'haunted-image-'));
  const outputPath = path.join(directory, 'image.png');
  const provider = new OpenAIProvider({ apiKey: 'test', baseUrl: 'https://api.example/v1', textModel: 'test-model', imageModel: 'test-image' });
  await provider.generateArtifact({ prompt: 'test', outputPath });
  assert.deepEqual(await readFile(outputPath), expected);
});
