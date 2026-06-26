import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createArtifactProvider, ImageArtifactProvider, MockArtifactProvider } from '../src/providers/artifact-provider.js';

const KEY = 'sk-secret-key-1234567890';

async function outPath(name) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'haunted-artifact-'));
  return path.join(dir, name);
}

test('adapters report their file extensions and modes', () => {
  assert.equal(new MockArtifactProvider().fileExtension, 'svg');
  assert.equal(createArtifactProvider('mock').mode, 'mock');
  assert.equal(createArtifactProvider('image', { HAUNTED_STUDIO_IMAGE_API_KEY: KEY }).fileExtension, 'png');
});

test('the mock adapter writes a deterministic placeholder offline', async () => {
  const file = await outPath('artifact.svg');
  await new MockArtifactProvider().generateArtifact({ prompt: 'a quiet room', outputPath: file });
  const svg = await readFile(file, 'utf8');
  assert.match(svg, /<svg/);
  assert.match(svg, /MOCK ARTIFACT/);
});

test('image mode requires an API key', async () => {
  const provider = new ImageArtifactProvider({}, async () => { throw new Error('should not be called'); });
  await assert.rejects(provider.generateArtifact({ prompt: 'x', outputPath: await outPath('a.png') }), /API_KEY is required/);
});

test('image mode decodes and writes the returned image bytes', async () => {
  const pngBytes = Buffer.from('\x89PNG fake image payload');
  const fetchStub = async (url, options) => {
    assert.match(url, /\/images\/generations$/);
    assert.match(options.headers.Authorization, /Bearer sk-secret/);
    return { ok: true, json: async () => ({ data: [{ b64_json: pngBytes.toString('base64') }] }) };
  };
  const provider = new ImageArtifactProvider({ HAUNTED_STUDIO_IMAGE_API_KEY: KEY }, fetchStub);
  const file = await outPath('artifact.png');
  await provider.generateArtifact({ prompt: 'a quiet room', outputPath: file });
  assert.deepEqual(await readFile(file), pngBytes);
});

test('image mode follows a returned https url when there is no base64', async () => {
  const imageBytes = Buffer.from('downloaded-png-bytes');
  const fetchStub = async (url) => {
    if (url.endsWith('/images/generations')) {
      return { ok: true, json: async () => ({ data: [{ url: 'https://cdn.example.com/generated.png' }] }) };
    }
    assert.equal(url, 'https://cdn.example.com/generated.png');
    return { ok: true, headers: { get: () => String(imageBytes.length) }, arrayBuffer: async () => imageBytes.buffer.slice(imageBytes.byteOffset, imageBytes.byteOffset + imageBytes.length) };
  };
  const provider = new ImageArtifactProvider({ HAUNTED_STUDIO_IMAGE_API_KEY: KEY }, fetchStub);
  const file = await outPath('artifact.png');
  await provider.generateArtifact({ prompt: 'a quiet room', outputPath: file });
  assert.deepEqual(await readFile(file), imageBytes);
});

test('image mode refuses a non-https image url', async () => {
  const fetchStub = async () => ({ ok: true, json: async () => ({ data: [{ url: 'http://insecure.example.com/x.png' }] }) });
  const provider = new ImageArtifactProvider({ HAUNTED_STUDIO_IMAGE_API_KEY: KEY }, fetchStub);
  await assert.rejects(provider.generateArtifact({ prompt: 'x', outputPath: await outPath('a.png') }), /non-https/);
});

test('image mode enforces a download size cap', async () => {
  const fetchStub = async (url) => {
    if (url.endsWith('/images/generations')) return { ok: true, json: async () => ({ data: [{ url: 'https://cdn.example.com/huge.png' }] }) };
    return { ok: true, headers: { get: () => String(64 * 1024 * 1024) }, arrayBuffer: async () => new ArrayBuffer(0) };
  };
  const provider = new ImageArtifactProvider({ HAUNTED_STUDIO_IMAGE_API_KEY: KEY }, fetchStub);
  await assert.rejects(provider.generateArtifact({ prompt: 'x', outputPath: await outPath('a.png') }), /size cap/);
});

test('an error response never leaks the API key', async () => {
  const fetchStub = async () => ({ ok: false, status: 401, text: async () => `Unauthorized: key ${KEY} is invalid` });
  const provider = new ImageArtifactProvider({ HAUNTED_STUDIO_IMAGE_API_KEY: KEY }, fetchStub);
  await assert.rejects(provider.generateArtifact({ prompt: 'x', outputPath: await outPath('a.png') }), (error) => {
    assert.ok(error.message.includes('[redacted]'), 'message should redact the key');
    assert.ok(!error.message.includes(KEY), 'message must not contain the raw key');
    return true;
  });
});

test('a network error never leaks the API key', async () => {
  const fetchStub = async () => { throw new Error(`connect failed using ${KEY}`); };
  const provider = new ImageArtifactProvider({ HAUNTED_STUDIO_IMAGE_API_KEY: KEY }, fetchStub);
  await assert.rejects(provider.generateArtifact({ prompt: 'x', outputPath: await outPath('a.png') }), (error) => {
    assert.ok(!error.message.includes(KEY));
    return true;
  });
});
