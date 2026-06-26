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

function streamFrom(buffer) {
  return new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(buffer)); controller.close(); } });
}

function chunkedStream(totalBytes, chunk = 4) {
  let sent = 0;
  return new ReadableStream({ pull(controller) {
    if (sent >= totalBytes) { controller.close(); return; }
    const n = Math.min(chunk, totalBytes - sent); sent += n;
    controller.enqueue(new Uint8Array(n));
  } });
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
  const fetchStub = async (url, options) => {
    if (url.endsWith('/images/generations')) {
      return { ok: true, json: async () => ({ data: [{ url: 'https://cdn.example.com/generated.png' }] }) };
    }
    assert.equal(url, 'https://cdn.example.com/generated.png');
    assert.equal(options.redirect, 'error', 'download must not follow redirects');
    return { ok: true, headers: { get: () => String(imageBytes.length) }, body: streamFrom(imageBytes) };
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

test('image mode refuses a private or loopback image url', async () => {
  const fetchStub = async () => ({ ok: true, json: async () => ({ data: [{ url: 'https://169.254.169.254/latest/meta-data/' }] }) });
  const provider = new ImageArtifactProvider({ HAUNTED_STUDIO_IMAGE_API_KEY: KEY }, fetchStub);
  await assert.rejects(provider.generateArtifact({ prompt: 'x', outputPath: await outPath('a.png') }), /private or loopback/);
});

test('image mode caps a streamed download without buffering it whole', async () => {
  const fetchStub = async (url) => {
    if (url.endsWith('/images/generations')) return { ok: true, json: async () => ({ data: [{ url: 'https://cdn.example.com/huge.png' }] }) };
    // No content-length, and the stream exceeds the (tiny) cap.
    return { ok: true, headers: { get: () => null }, body: chunkedStream(64) };
  };
  const provider = new ImageArtifactProvider({ HAUNTED_STUDIO_IMAGE_API_KEY: KEY, HAUNTED_STUDIO_IMAGE_MAX_BYTES: '16' }, fetchStub);
  await assert.rejects(provider.generateArtifact({ prompt: 'x', outputPath: await outPath('a.png') }), /size cap/);
});

test('image mode refuses to send the API key to a non-https base URL', async () => {
  let called = false;
  const fetchStub = async () => { called = true; return { ok: true, json: async () => ({}) }; };
  const provider = new ImageArtifactProvider({ HAUNTED_STUDIO_IMAGE_API_KEY: KEY, HAUNTED_STUDIO_IMAGE_BASE_URL: 'http://evil.example.com/v1' }, fetchStub);
  await assert.rejects(provider.generateArtifact({ prompt: 'x', outputPath: await outPath('a.png') }), /must use https/);
  assert.equal(called, false, 'the key must never be sent over http');
});

test('a non-gpt-image model omits the gpt-image-only output_format parameter', async () => {
  let sentBody;
  const fetchStub = async (url, options) => {
    sentBody = JSON.parse(options.body);
    return { ok: true, json: async () => ({ data: [{ b64_json: Buffer.from('x').toString('base64') }] }) };
  };
  const provider = new ImageArtifactProvider({ HAUNTED_STUDIO_IMAGE_API_KEY: KEY, HAUNTED_STUDIO_IMAGE_MODEL: 'dall-e-3' }, fetchStub);
  await provider.generateArtifact({ prompt: 'x', outputPath: await outPath('a.png') });
  assert.ok(!('output_format' in sentBody), 'dall-e must not receive output_format');
});

test('a failed image download does not leak the signed url or token', async () => {
  const signed = 'https://cdn.example.com/x.png?sig=SUPERSECRETTOKEN';
  const fetchStub = async (url) => {
    if (url.endsWith('/images/generations')) return { ok: true, json: async () => ({ data: [{ url: signed }] }) };
    throw new Error(`fetch failed for ${signed}`);
  };
  const provider = new ImageArtifactProvider({ HAUNTED_STUDIO_IMAGE_API_KEY: KEY }, fetchStub);
  await assert.rejects(provider.generateArtifact({ prompt: 'x', outputPath: await outPath('a.png') }), (error) => {
    assert.ok(!error.message.includes('SUPERSECRETTOKEN'), 'must not leak the signed url');
    return true;
  });
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
