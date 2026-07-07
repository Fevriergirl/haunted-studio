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

// Open the SSE stream; resolves (once the stream is actually open, so nothing
// can be missed) with a watcher that collects `data:` frames as parsed events.
// watcher.until(predicate) resolves with all events seen once one matches;
// watcher.close() drops the connection.
function watchLive(port, timeoutMs = 30_000) {
  return new Promise((resolveOpen, rejectOpen) => {
    const events = [];
    let buffered = '';
    let pending = null; // { predicate, resolve }
    const req = http.request(
      { host: '127.0.0.1', port, path: '/api/live', method: 'GET', headers: { Host: `127.0.0.1:${port}` } },
      (res) => {
        if (res.statusCode !== 200 || !String(res.headers['content-type']).startsWith('text/event-stream')) {
          req.destroy();
          return rejectOpen(new Error(`unexpected live response: ${res.statusCode} ${res.headers['content-type']}`));
        }
        resolveOpen({
          until(predicate) {
            return new Promise((resolve, reject) => {
              const timer = setTimeout(() => { req.destroy(); reject(new Error('live stream timed out')); }, timeoutMs);
              timer.unref?.();
              pending = { predicate, resolve: (value) => { clearTimeout(timer); resolve(value); } };
              for (const event of events) if (predicate(event)) return pending.resolve(events);
            });
          },
          close() { req.destroy(); }
        });
        res.on('data', (chunk) => {
          buffered += chunk;
          let boundary;
          while ((boundary = buffered.indexOf('\n\n')) !== -1) {
            const frame = buffered.slice(0, boundary);
            buffered = buffered.slice(boundary + 2);
            const data = frame.split('\n').filter((line) => line.startsWith('data: ')).map((line) => line.slice(6)).join('\n');
            if (!data) continue; // retry/comment frames
            const event = JSON.parse(data);
            events.push(event);
            if (pending && pending.predicate(event)) pending.resolve(events);
          }
        });
      }
    );
    req.on('error', rejectOpen);
    req.end();
  });
}

async function withServer(run) {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), 'haunted-studio-live-'));
  const studio = new Studio({ rootDir, constitution, experiment });
  await studio.initialize();
  const server = startStudioServer({ studio, mode: 'mock', port: 0, host: '127.0.0.1' });
  await new Promise((resolve) => server.once('listening', resolve));
  const { port } = server.address();
  try { await run(port); } finally { server.close(); }
}

test('the live stream shows a cycle working step by step while it runs', async () => {
  await withServer(async (port) => {
    const watcher = await watchLive(port); // stream is open before the cycle starts
    const cycle = await request(port, 'POST', '/api/cycle', { seed: 'a hallway that keeps its own hours' });
    assert.equal(cycle.status, 200);

    const events = await watcher.until((event) => event.type === 'cycle_completed');
    watcher.close();

    // The stream begins when the cycle begins and ends when it completes —
    // the page watches the work happen, not a replay after the fact.
    assert.equal(events[0].type, 'cycle_started');
    assert.equal(events.at(-1).type, 'cycle_completed');
    const types = events.map((event) => event.type);
    for (const required of ['observation_selected', 'intention_locked', 'candidates_generated',
      'critics_reported', 'curation_decided', 'memory_consolidated']) {
      assert.ok(types.includes(required), `expected a live ${required} event`);
    }

    // Streamed events are the persisted ledger events themselves: same shape,
    // same hashes, same order as the after-the-fact provenance trail.
    const prov = await request(port, 'GET', `/api/cycle/${cycle.json.cycle_id}/provenance`);
    const cycleStream = events.filter((event) => event.cycle_id === cycle.json.cycle_id);
    assert.deepEqual(
      cycleStream.map(({ sequence, type, actor, hash, previous_hash }) => ({ sequence, type, actor, hash, previous_hash })),
      prov.json.events.map(({ sequence, type, actor, hash, previous_hash }) => ({ sequence, type, actor, hash, previous_hash }))
    );
    let last = 0;
    for (const event of events) {
      assert.ok(event.sequence > last, 'live events must arrive in ledger order');
      last = event.sequence;
    }
  });
});

test('a closed live stream unsubscribes and later cycles still run', async () => {
  await withServer(async (port) => {
    const watcher = await watchLive(port);
    const one = await request(port, 'POST', '/api/cycle', { seed: 'first idea' });
    assert.equal(one.status, 200);
    await watcher.until((event) => event.type === 'cycle_completed');
    watcher.close();

    const two = await request(port, 'POST', '/api/cycle', { seed: 'second idea' });
    assert.equal(two.status, 200, 'cycles keep working after a live client disconnects');
  });
});
