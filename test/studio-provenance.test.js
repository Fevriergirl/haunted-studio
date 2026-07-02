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

function request(port, method, reqPath, json) {
  return new Promise((resolve, reject) => {
    const data = json ? JSON.stringify(json) : null;
    const headers = { Host: `127.0.0.1:${port}` };
    if (data) { headers['Content-Type'] = 'application/json'; headers['Content-Length'] = Buffer.byteLength(data); }
    const req = http.request({ host: '127.0.0.1', port, path: reqPath, method, headers }, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => { let parsed = null; try { parsed = JSON.parse(body); } catch {} resolve({ status: res.statusCode, json: parsed }); });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

async function withServer(run) {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), 'haunted-studio-prov-'));
  const studio = new Studio({ rootDir, constitution, experiment });
  await studio.initialize();
  const server = startStudioServer({ studio, mode: 'mock', port: 0, host: '127.0.0.1' });
  await new Promise((resolve) => server.once('listening', resolve));
  const { port } = server.address();
  try { await run(port); } finally { server.close(); }
}

test('provenance returns the verified, role-separated trail behind a cycle', async () => {
  await withServer(async (port) => {
    const cycle = await request(port, 'POST', '/api/cycle', { seed: 'a kitchen that refuses to be entered' });
    assert.equal(cycle.status, 200);
    const cycleId = cycle.json.cycle_id;

    const prov = await request(port, 'GET', `/api/cycle/${cycleId}/provenance`);
    assert.equal(prov.status, 200);

    // The hash chain over the whole ledger verifies.
    assert.equal(prov.json.verification.valid, true);
    assert.ok(prov.json.verification.count >= prov.json.events.length);

    // The distinctive role-separated stages are all present as discrete events.
    const types = prov.json.events.map((e) => e.type);
    for (const required of ['observation_selected', 'intention_locked', 'candidates_generated',
      'critics_reported', 'curation_decided', 'memory_consolidated', 'cycle_completed']) {
      assert.ok(types.includes(required), `expected a ${required} event in the trail`);
    }

    // The independent post-result roles (what makes the project special) ran.
    const actors = prov.json.events.map((e) => e.actor);
    assert.ok(actors.includes('role:artifact-witness'), 'a blind witness must appear');
    assert.ok(actors.includes('role:adversarial-surprise-reviewer'), 'an adversarial reviewer must appear');

    // Events are ordered and every link carries the chain hashes.
    let last = 0;
    for (const event of prov.json.events) {
      assert.ok(event.sequence > last, 'events must be in increasing sequence');
      last = event.sequence;
      assert.match(event.hash, /^[0-9a-f]{64}$/);
      assert.match(event.previous_hash, /^[0-9a-f]{64}$/);
    }
  });
});

test('provenance for an unknown cycle is empty but still verifies', async () => {
  await withServer(async (port) => {
    const prov = await request(port, 'GET', '/api/cycle/cycle_does_not_exist/provenance');
    assert.equal(prov.status, 200);
    assert.deepEqual(prov.json.events, []);
    assert.equal(prov.json.verification.valid, true);
  });
});
