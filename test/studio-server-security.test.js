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

// Raw request lets us forge the Host header (fetch forbids setting it).
function request(port, requestPath, { host = '127.0.0.1' } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: requestPath, method: 'GET', headers: { Host: host } }, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    req.on('error', reject);
    req.end();
  });
}

async function withServer(run) {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), 'haunted-studio-sec-'));
  const studio = new Studio({ rootDir, constitution, experiment });
  await studio.initialize();
  const server = startStudioServer({ studio, mode: 'mock', port: 0, host: '127.0.0.1' });
  await new Promise((resolve) => server.once('listening', resolve));
  const { port } = server.address();
  try { await run(port); } finally { server.close(); }
}

test('a loopback Host is accepted', async () => {
  await withServer(async (port) => {
    const res = await request(port, '/api/config', { host: `127.0.0.1:${port}` });
    assert.equal(res.status, 200);
  });
});

test('a foreign Host header is rejected (blocks DNS rebinding)', async () => {
  await withServer(async (port) => {
    const res = await request(port, '/api/config', { host: 'evil.example.com' });
    assert.equal(res.status, 403);
  });
});

test('artifact path traversal cannot escape the artifacts directory', async () => {
  await withServer(async (port) => {
    for (const attempt of [
      '/artifacts/cycles/../../../etc/passwd',
      '/artifacts/cycles/%2e%2e/%2e%2e/etc/passwd',
      '/artifacts/cycles/../secret'
    ]) {
      const res = await request(port, attempt, { host: `127.0.0.1:${port}` });
      assert.notEqual(res.status, 200, `${attempt} must not resolve to a file`);
    }
  });
});
