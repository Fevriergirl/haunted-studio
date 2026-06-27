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
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
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
const DOT_ONLY = /^\.+$/;

// Only accept requests whose Host header is a loopback name or the address the
// server was deliberately bound to. This blocks DNS-rebinding (where a malicious
// page resolves a domain to 127.0.0.1 but sends its own Host) and stops a
// browser page from silently driving side-effecting endpoints on another host.
function hostAllowed(hostHeader, boundHost) {
  if (typeof hostHeader !== 'string' || !hostHeader) return false;
  const name = hostHeader.replace(/:\d+$/, '').toLowerCase();
  return name === '127.0.0.1' || name === 'localhost' || name === '::1' || name === '[::1]' ||
    name === String(boundHost).toLowerCase();
}

const DEFAULT_IMAGE_BASE_URL = 'https://api.openai.com/v1';
const SUGGESTED_MODELS = ['gpt-image-1', 'dall-e-3'];

// CSRF guard. Browsers always attach Sec-Fetch-Site on requests they originate
// and JS cannot forge or strip it; a cross-origin page can otherwise issue a
// CORS "simple request" (e.g. Content-Type: text/plain, which we still parse as
// JSON) to a state-changing endpoint on loopback. Reject anything the browser
// labels as not same-origin. Non-browser clients (curl, the CLI, the test
// suite) omit the header entirely, so an absent value is allowed.
function isCrossSiteRequest(request) {
  const site = request.headers['sec-fetch-site'];
  return typeof site === 'string' && site !== 'same-origin' && site !== 'none';
}

export function startStudioServer({ studio, mode = 'mock', port = 19830, host = '127.0.0.1', fetchImpl = globalThis.fetch }) {
  const artifactsBase = path.resolve(studio.rootDir, 'artifacts', 'cycles');
  // The image API key lives ONLY in this process's memory: seeded from the env if
  // present, set via the UI, and never written to disk, returned, or logged.
  let imageKey = process.env.HAUNTED_STUDIO_IMAGE_API_KEY ?? null;
  const redact = (text) => (imageKey ? String(text).replaceAll(imageKey, '[redacted]') : String(text));
  const imageBaseUrl = () => (process.env.HAUNTED_STUDIO_IMAGE_BASE_URL ?? DEFAULT_IMAGE_BASE_URL).replace(/\/$/, '');
  const server = http.createServer(async (request, response) => {
    if (!hostAllowed(request.headers.host, host)) {
      return sendJson(response, 403, { error: 'forbidden host' });
    }
    // Block cross-site state changes before any side-effecting route runs.
    if (request.method !== 'GET' && request.method !== 'HEAD' && isCrossSiteRequest(request)) {
      return sendJson(response, 403, { error: 'cross-site request blocked' });
    }
    const url = new URL(request.url, `http://${request.headers.host}`);
    try {
      if (request.method === 'GET' && (url.pathname === '/' || url.pathname === '/studio')) {
        return await sendFile(response, path.join(PUBLIC_DIR, 'index.html'));
      }
      if (request.method === 'GET' && url.pathname === '/app.js') {
        return await sendFile(response, path.join(PUBLIC_DIR, 'app.js'));
      }
      if (request.method === 'GET' && url.pathname === '/api/config') {
        return sendJson(response, 200, {
          mode,
          default_mode: 'mock',
          image_key_present: Boolean(imageKey),
          model: process.env.HAUNTED_STUDIO_IMAGE_MODEL ?? SUGGESTED_MODELS[0],
          size: process.env.HAUNTED_STUDIO_IMAGE_SIZE ?? '1024x1024',
          image_base_host: (() => { try { return new URL(imageBaseUrl()).host; } catch { return imageBaseUrl(); } })(),
          suggested_models: SUGGESTED_MODELS
        });
      }
      if (request.method === 'POST' && url.pathname === '/api/image/key') {
        const body = await readBody(request);
        if (typeof body.key !== 'string' || !body.key.trim()) return sendJson(response, 400, { error: 'key is required' });
        imageKey = body.key.trim(); // in-memory only; never persisted or echoed
        return sendJson(response, 200, { image_key_present: true });
      }
      if (request.method === 'POST' && url.pathname === '/api/image/key/clear') {
        imageKey = null;
        return sendJson(response, 200, { image_key_present: false });
      }
      if (request.method === 'POST' && url.pathname === '/api/image/test') {
        if (!imageKey) return sendJson(response, 200, { ok: false, error: 'No image API key set.' });
        // Never send the key to a non-https endpoint (loopback http allowed for dev).
        let baseParsed;
        try { baseParsed = new URL(imageBaseUrl()); } catch { return sendJson(response, 200, { ok: false, error: 'Invalid image base URL.' }); }
        const loopback = baseParsed.hostname === 'localhost' || baseParsed.hostname === '127.0.0.1' || baseParsed.hostname === '::1';
        if (baseParsed.protocol !== 'https:' && !(baseParsed.protocol === 'http:' && loopback)) {
          return sendJson(response, 200, { ok: false, error: 'Image base URL must use https; refusing to send the key in cleartext.' });
        }
        let res;
        try {
          res = await fetchImpl(`${imageBaseUrl()}/models`, { headers: { Authorization: `Bearer ${imageKey}` }, signal: AbortSignal.timeout(30_000) });
        } catch {
          return sendJson(response, 200, { ok: false, error: 'Could not reach the image endpoint.' });
        }
        if (res.ok) return sendJson(response, 200, { ok: true });
        return sendJson(response, 200, { ok: false, status: res.status, error: redact((await res.text()).slice(0, 300)) });
      }
      if (request.method === 'GET' && url.pathname === '/api/state') {
        await studio.initialize();
        return sendJson(response, 200, await studio.getState());
      }
      if (request.method === 'POST' && url.pathname === '/api/cycle') {
        const body = await readBody(request);
        if (typeof body.seed !== 'string' || !body.seed.trim()) return sendJson(response, 400, { error: 'seed is required' });
        const wantImage = body.mode === 'image' || (body.mode == null && mode === 'image');
        let env = process.env;
        if (wantImage) {
          if (!imageKey) return sendJson(response, 400, { error: 'Set an image API key first (Setup → Image), or use mock mode.' });
          env = { ...process.env, HAUNTED_STUDIO_IMAGE_API_KEY: imageKey };
          if (typeof body.model === 'string' && body.model.trim()) env.HAUNTED_STUDIO_IMAGE_MODEL = body.model.trim();
          if (typeof body.size === 'string' && body.size.trim()) env.HAUNTED_STUDIO_IMAGE_SIZE = body.size.trim();
        }
        const summary = await beginStudioCycle({
          studio, seed: body.seed.trim(), mode: wantImage ? 'image' : 'mock',
          operationId: body.operation_id ?? id('studio-cycle'), env
        });
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
        if (!SAFE_SEGMENT.test(cycleId) || !SAFE_SEGMENT.test(file) || DOT_ONLY.test(cycleId) || DOT_ONLY.test(file)) {
          return sendJson(response, 400, { error: 'invalid artifact path' });
        }
        // Defense in depth: the resolved path must stay inside the artifacts dir.
        const filePath = path.resolve(artifactsBase, cycleId, file);
        if (filePath !== path.join(artifactsBase, cycleId, file) || !filePath.startsWith(artifactsBase + path.sep)) {
          return sendJson(response, 400, { error: 'invalid artifact path' });
        }
        return await sendFile(response, filePath);
      }
      return sendJson(response, 404, { error: 'not found' });
    } catch (error) {
      if (error.code === 'ENOENT') return sendJson(response, 404, { error: 'not found' });
      // Redact defensively: a deep error must never surface the in-memory key.
      return sendJson(response, error.statusCode ?? 500, { error: redact(error.message) });
    }
  });
  server.listen(port, host);
  return server;
}
