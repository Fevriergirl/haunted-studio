// Studio interface server — a thin, zero-dependency stdlib HTTP layer over the
// engine. Every endpoint just calls an existing engine function; no business
// logic lives here.

import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { id } from '../core/ids.js';
import { beginStudioCycle } from '../engine/studio-cycle.js';
import { recordArtifactDecision } from '../engine/studio-decision.js';

const PUBLIC_DIR = fileURLToPath(new URL('./public/', import.meta.url));
const MAX_BODY_BYTES = 1_000_000;
const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json'
};

function sendJson(response, status, body) {
  response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  response.end(JSON.stringify(body));
}

async function readBody(request) {
  const chunks = [];
  let total = 0;
  for await (const chunk of request) {
    total += chunk.length;
    if (total > MAX_BODY_BYTES) { const error = new Error('Request body exceeds 1 MB.'); error.statusCode = 413; throw error; }
    chunks.push(chunk);
  }
  if (chunks.length === 0) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { const error = new Error('Request body must be valid JSON.'); error.statusCode = 400; throw error; }
}

async function sendFile(response, filePath, fallbackStatus = 200) {
  const data = await readFile(filePath);
  response.writeHead(fallbackStatus, { 'Content-Type': CONTENT_TYPES[path.extname(filePath)] ?? 'application/octet-stream', 'X-Content-Type-Options': 'nosniff' });
  response.end(data);
}

const SAFE_SEGMENT = /^[A-Za-z0-9._-]+$/;

export function startStudioServer({ studio, mode = 'mock', port = 19830, host = '127.0.0.1' }) {
  const server = http.createServer(async (request, response) => {
    const url = new URL(request.url, `http://${request.headers.host ?? host}`);
    try {
      if (request.method === 'GET' && (url.pathname === '/' || url.pathname === '/studio')) {
        return await sendFile(response, path.join(PUBLIC_DIR, 'index.html'));
      }
      if (request.method === 'GET' && url.pathname === '/app.js') {
        return await sendFile(response, path.join(PUBLIC_DIR, 'app.js'));
      }
      if (request.method === 'GET' && url.pathname === '/api/config') {
        return sendJson(response, 200, { mode, default_mode: 'mock' });
      }
      if (request.method === 'GET' && url.pathname === '/api/state') {
        await studio.initialize();
        return sendJson(response, 200, await studio.getState());
      }
      if (request.method === 'POST' && url.pathname === '/api/cycle') {
        const body = await readBody(request);
        if (typeof body.seed !== 'string' || !body.seed.trim()) return sendJson(response, 400, { error: 'seed is required' });
        const summary = await beginStudioCycle({ studio, seed: body.seed.trim(), mode: body.mode === 'image' ? 'image' : mode, operationId: body.operation_id ?? id('studio-cycle') });
        return sendJson(response, 200, summary);
      }
      const decisionMatch = url.pathname.match(/^\/api\/cycle\/([A-Za-z0-9._-]+)\/decision$/);
      if (request.method === 'POST' && decisionMatch) {
        const body = await readBody(request);
        const result = await recordArtifactDecision({ studio, cycleId: decisionMatch[1], decision: body.decision, note: body.note ?? '', operationId: body.operation_id ?? id('decision') });
        return sendJson(response, 200, { decision: result.decision, state: result.state });
      }
      const artifactMatch = url.pathname.match(/^\/artifacts\/cycles\/([^/]+)\/([^/]+)$/);
      if (request.method === 'GET' && artifactMatch) {
        const [, cycleId, file] = artifactMatch;
        if (!SAFE_SEGMENT.test(cycleId) || !SAFE_SEGMENT.test(file)) return sendJson(response, 400, { error: 'invalid artifact path' });
        return await sendFile(response, path.join(studio.rootDir, 'artifacts', 'cycles', cycleId, file));
      }
      return sendJson(response, 404, { error: 'not found' });
    } catch (error) {
      if (error.code === 'ENOENT') return sendJson(response, 404, { error: 'not found' });
      return sendJson(response, error.statusCode ?? 500, { error: error.message });
    }
  });
  server.listen(port, host);
  return server;
}
