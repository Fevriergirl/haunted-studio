import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Studio } from '../src/core/studio.js';
import { startStudioServer } from '../src/studio/server.js';
import { readJson } from '../src/core/fs.js';

const cwd = process.cwd();
const constitution = await readJson(path.join(cwd, 'config', 'constitution.json'));
const experiment = await readJson(path.join(cwd, 'config', 'experiment.json'));

function request(port, method, reqPath, { host, json, extraHeaders } = {}) {
  return new Promise((resolve, reject) => {
    const data = json ? JSON.stringify(json) : null;
    const headers = { Host: host ?? `127.0.0.1:${port}`, ...extraHeaders };
    if (data) { headers['Content-Type'] = 'application/json'; headers['Content-Length'] = Buffer.byteLength(data); }
    const req = http.request({ host: '127.0.0.1', port, path: reqPath, method, headers }, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => { let parsed = null; try { parsed = JSON.parse(body); } catch {} resolve({ status: res.statusCode, text: body, json: parsed }); });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

async function withServer(fetchImpl, run) {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), 'haunted-studio-cfg-'));
  const studio = new Studio({ rootDir, constitution, experiment });
  await studio.initialize();
  const server = startStudioServer({ studio, mode: 'mock', port: 0, host: '127.0.0.1', fetchImpl });
  await new Promise((resolve) => server.once('listening', resolve));
  const { port } = server.address();
  try { await run(port); } finally { server.close(); }
}

test('config reports key presence and suggested models without exposing a key', async () => {
  await withServer(undefined, async (port) => {
    const r = await request(port, 'GET', '/api/config');
    assert.equal(r.status, 200);
    assert.equal(r.json.image_key_present, false);
    assert.ok(Array.isArray(r.json.suggested_models));
    assert.ok('image_base_host' in r.json);
  });
});

test('setting then clearing the image key flips presence and never echoes the key', async () => {
  await withServer(undefined, async (port) => {
    const KEY = 'sk-INMEM-DO-NOT-ECHO-1234';
    const set = await request(port, 'POST', '/api/image/key', { json: { key: KEY } });
    assert.equal(set.status, 200);
    assert.equal(set.json.image_key_present, true);
    assert.ok(!set.text.includes(KEY), 'the set response must not echo the key');

    const cfg = await request(port, 'GET', '/api/config');
    assert.equal(cfg.json.image_key_present, true);
    assert.ok(!cfg.text.includes(KEY), 'config must not contain the key');

    const cleared = await request(port, 'POST', '/api/image/key/clear');
    assert.equal(cleared.json.image_key_present, false);
  });
});

test('an image cycle without a key is refused before any provider call', async () => {
  await withServer(undefined, async (port) => {
    const r = await request(port, 'POST', '/api/cycle', { json: { seed: 'a quiet room', mode: 'image' } });
    assert.equal(r.status, 400);
    assert.match(r.json.error, /image API key/i);
  });
});

test('connection test validates auth and redacts the key on error', async () => {
  const KEY = 'sk-TESTCONN-SUPERSECRET';
  let calls = 0;
  const fetchStub = async (url, options) => {
    calls += 1;
    assert.match(url, /\/models$/);
    assert.equal(options.headers.Authorization, `Bearer ${KEY}`);
    if (calls === 1) return { ok: true, text: async () => '{}' };
    return { ok: false, status: 401, text: async () => `Unauthorized: key ${KEY} rejected` };
  };
  await withServer(fetchStub, async (port) => {
    await request(port, 'POST', '/api/image/key', { json: { key: KEY } });
    const ok = await request(port, 'POST', '/api/image/test');
    assert.equal(ok.json.ok, true);
    const bad = await request(port, 'POST', '/api/image/test');
    assert.equal(bad.json.ok, false);
    assert.ok(bad.text.includes('[redacted]'), 'error must be redacted');
    assert.ok(!bad.text.includes(KEY), 'raw key must never appear');
  });
});

test('a cross-site POST is blocked before any side effect, but absent Sec-Fetch-Site works', async () => {
  await withServer(undefined, async (port) => {
    const KEY = 'sk-CSRF-VICTIM-KEY';
    // Seed an in-memory key via a normal (no Sec-Fetch-Site) request.
    await request(port, 'POST', '/api/image/key', { json: { key: KEY } });

    // A forged cross-site request must not be able to clear it.
    const attack = await request(port, 'POST', '/api/image/key/clear', { extraHeaders: { 'Sec-Fetch-Site': 'cross-site' } });
    assert.equal(attack.status, 403);
    assert.match(attack.json.error, /cross-site/i);

    // The key survived the attempt.
    const cfg = await request(port, 'GET', '/api/config');
    assert.equal(cfg.json.image_key_present, true);

    // same-origin is allowed; clear works as expected.
    const cleared = await request(port, 'POST', '/api/image/key/clear', { extraHeaders: { 'Sec-Fetch-Site': 'same-origin' } });
    assert.equal(cleared.status, 200);
    assert.equal(cleared.json.image_key_present, false);
  });
});

test('connection test with no key set reports not-ok without calling out', async () => {
  let called = false;
  await withServer(async () => { called = true; return { ok: true, text: async () => '{}' }; }, async (port) => {
    const r = await request(port, 'POST', '/api/image/test');
    assert.equal(r.json.ok, false);
    assert.equal(called, false);
  });
});
