// Artifact provider adapter — the seam that keeps image-generation logic out of
// the core engine. `mock` (default) produces a deterministic placeholder so the
// app works fully offline; `image` reads credentials from the environment and
// calls a real provider (OpenAI-images-compatible, or Cloudflare Workers AI).

import { createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { ensureDir } from '../core/fs.js';
import { DeterministicProvider } from './deterministic-provider.js';

function escapeXml(value) {
  return String(value).replace(/[<>&'"]/g, (character) =>
    ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[character]));
}

// A visible mock artifact: shapes and palette derived deterministically from the
// prompt, so the same prompt always yields the same placeholder image.
export function mockArtifactSvg(prompt) {
  const hash = createHash('sha256').update(String(prompt)).digest('hex');
  const byte = (start) => parseInt(hash.slice(start, start + 2), 16) / 255;
  const hue = Math.round(byte(0) * 360);
  const accent = Math.round(byte(2) * 360);
  const cx = Math.round(120 + byte(4) * 784);
  const cy = Math.round(120 + byte(6) * 700);
  const radius = Math.round(90 + byte(8) * 260);
  const tilt = Math.round(byte(10) * 40 - 20);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
  <rect width="1024" height="1024" fill="hsl(${hue} 30% 12%)"/>
  <g transform="rotate(${tilt} 512 512)">
    <circle cx="${cx}" cy="${cy}" r="${radius}" fill="hsl(${accent} 55% 48%)" opacity="0.85"/>
    <rect x="${cx - radius}" y="${cy - 6}" width="${radius * 2}" height="12" fill="hsl(${hue} 20% 80%)" opacity="0.4"/>
  </g>
  <rect x="0" y="952" width="1024" height="72" fill="hsl(${hue} 25% 7%)"/>
  <text x="28" y="996" fill="#e9e9e9" font-family="monospace" font-size="22">MOCK ARTIFACT · ${escapeXml(prompt).slice(0, 78)}</text>
</svg>`;
}

export class MockArtifactProvider {
  get mode() { return 'mock'; }
  get fileExtension() { return 'svg'; }

  async generateArtifact({ prompt, outputPath }) {
    await ensureDir(path.dirname(outputPath));
    await writeFile(outputPath, mockArtifactSvg(prompt), 'utf8');
    return outputPath;
  }
}

const IMAGE_REQUEST_TIMEOUT_MS = 120_000;
const MAX_IMAGE_BYTES = 25 * 1024 * 1024;
const CF_FLUX_MODEL = '@cf/black-forest-labs/flux-1-schnell';
const CF_PROMPT_MAX = 2048; // FLUX schnell input limit.

// The credentialed request must never go anywhere but https (loopback http is
// allowed for local development), so the API key is never sent in cleartext.
function assertSafeRequestUrl(rawUrl) {
  let url;
  try { url = new URL(rawUrl); } catch { throw new Error('HAUNTED_STUDIO_IMAGE_BASE_URL is not a valid URL.'); }
  const loopback = url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '::1';
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) {
    throw new Error(`HAUNTED_STUDIO_IMAGE_BASE_URL must use https (got ${url.protocol}//${url.hostname}); refusing to send the API key in cleartext.`);
  }
}

// Best-effort block of IP-literal private/loopback/link-local download targets.
// (Domain names that resolve to private IPs are not caught — documented.)
function isBlockedHost(hostname) {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.localhost')) return true;
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) {
    return /^(127|10|0)\./.test(host) || /^192\.168\./.test(host) ||
      /^169\.254\./.test(host) || /^172\.(1[6-9]|2\d|3[01])\./.test(host);
  }
  if (host.includes(':')) {
    // `::ffff:a.b.c.d` (IPv4-mapped IPv6) routes to the embedded IPv4 host, so it
    // must be blocked too; the URL parser normalizes it to `::ffff:<hex:hex>`.
    return host === '::1' || host === '::' || host.startsWith('::ffff:') ||
      host.startsWith('fe80:') || host.startsWith('fc') || host.startsWith('fd');
  }
  return false;
}

// Read a response body with a hard cap that bounds memory: it aborts as soon as
// the cumulative size exceeds the cap, never buffering an unbounded stream.
async function readCapped(response, cap) {
  const reader = response.body?.getReader?.();
  if (!reader) {
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length > cap) throw new Error('Image download exceeds the size cap.');
    return buffer;
  }
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > cap) { await reader.cancel(); throw new Error('Image download exceeds the size cap.'); }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks);
}

// Calls a real image provider. Credentials come only from the environment and
// are never logged, embedded in metadata, or returned in an error — every
// outward message is redacted. Two provider shapes are supported:
//   - openai      (default): POST {base}/images/generations, read b64_json|url.
//   - cloudflare            : Cloudflare Workers AI FLUX (free tier), read result.image.
export class ImageArtifactProvider {
  constructor(env = process.env, fetchImpl = globalThis.fetch) {
    this.provider = (env.HAUNTED_STUDIO_IMAGE_PROVIDER ?? 'openai').toLowerCase();
    this.apiKey = env.HAUNTED_STUDIO_IMAGE_API_KEY ?? null;
    this.baseUrl = (env.HAUNTED_STUDIO_IMAGE_BASE_URL ?? 'https://api.openai.com/v1').replace(/\/$/, '');
    this.model = env.HAUNTED_STUDIO_IMAGE_MODEL ?? (this.provider === 'cloudflare' ? CF_FLUX_MODEL : 'gpt-image-2');
    this.size = env.HAUNTED_STUDIO_IMAGE_SIZE ?? '1024x1024';
    this.cfAccountId = env.HAUNTED_STUDIO_CF_ACCOUNT_ID ?? null;
    this.maxBytes = Number(env.HAUNTED_STUDIO_IMAGE_MAX_BYTES) || MAX_IMAGE_BYTES;
    this.fetchImpl = fetchImpl;
  }

  get mode() { return 'image'; }
  // FLUX returns JPEG; OpenAI-images returns PNG. Name the file honestly so the
  // static host serves the right Content-Type.
  get fileExtension() { return this.provider === 'cloudflare' ? 'jpg' : 'png'; }

  redact(text) {
    return this.apiKey ? String(text).replaceAll(this.apiKey, '[redacted]') : String(text);
  }

  async generateArtifact({ prompt, outputPath }) {
    if (!this.apiKey) {
      throw new Error('HAUNTED_STUDIO_IMAGE_API_KEY is required for image mode; run in mock mode to work without keys.');
    }
    const bytes = this.provider === 'cloudflare'
      ? await this.generateCloudflare(prompt)
      : await this.generateOpenAI(prompt);
    await ensureDir(path.dirname(outputPath));
    await writeFile(outputPath, bytes);
    return outputPath;
  }

  // Cloudflare Workers AI FLUX. The account id is public (not a secret); the API
  // token is the credential and is redacted from every outward message.
  async generateCloudflare(prompt) {
    if (!this.cfAccountId) {
      throw new Error('HAUNTED_STUDIO_CF_ACCOUNT_ID is required for the cloudflare image provider.');
    }
    const model = /^@cf\//.test(this.model) ? this.model : CF_FLUX_MODEL;
    const url = `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(this.cfAccountId)}/ai/run/${model}`;
    let response;
    try {
      response = await this.fetchImpl(url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(IMAGE_REQUEST_TIMEOUT_MS),
        body: JSON.stringify({ prompt: String(prompt).slice(0, CF_PROMPT_MAX), steps: 4 })
      });
    } catch (error) {
      throw new Error(this.redact(`Cloudflare image request failed: ${error.message}`));
    }
    if (!response.ok) {
      throw new Error(`Cloudflare image provider returned ${response.status}: ${this.redact((await response.text()).slice(0, 500))}`);
    }
    const result = await response.json();
    const b64 = result?.result?.image;
    if (typeof b64 !== 'string') {
      throw new Error('Cloudflare image response did not contain image data (no result.image).');
    }
    const buffer = Buffer.from(b64, 'base64');
    if (buffer.length > this.maxBytes) throw new Error('Image exceeds the size cap.');
    return buffer;
  }

  async generateOpenAI(prompt) {
    assertSafeRequestUrl(this.baseUrl);
    // `output_format` is a gpt-image parameter; dall-e-style models reject it, so
    // only send it when the model is a gpt-image one. Other models default to a
    // url response, which the download path below handles.
    const body = { model: this.model, prompt, size: this.size };
    if (/gpt-image/i.test(this.model)) body.output_format = 'png';
    let response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}/images/generations`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(IMAGE_REQUEST_TIMEOUT_MS),
        body: JSON.stringify(body)
      });
    } catch (error) {
      throw new Error(this.redact(`Image provider request failed: ${error.message}`));
    }
    if (!response.ok) {
      const errBody = this.redact((await response.text()).slice(0, 500));
      throw new Error(`Image provider returned ${response.status}: ${errBody}`);
    }
    const result = await response.json();
    const datum = result?.data?.[0] ?? {};
    if (typeof datum.b64_json === 'string') {
      return Buffer.from(datum.b64_json, 'base64');
    }
    if (typeof datum.url === 'string') {
      // Some endpoints (e.g. dall-e, several compatible providers) return a URL
      // instead of base64. Follow it, but only over https and within a size cap.
      return this.downloadImage(datum.url);
    }
    throw new Error('Image provider response did not contain image data (no b64_json or url).');
  }

  async downloadImage(rawUrl) {
    let url;
    try { url = new URL(rawUrl); } catch { throw new Error('Image provider returned an invalid image URL.'); }
    if (url.protocol !== 'https:') throw new Error(`Image provider returned a non-https image URL (${url.protocol}).`);
    if (isBlockedHost(url.hostname)) throw new Error('Image provider returned a private or loopback image URL.');
    let response;
    try {
      // `redirect: 'error'` prevents a benign https URL from redirecting the fetch
      // to an internal host (the protocol/host checks above only see the first URL).
      response = await this.fetchImpl(rawUrl, { redirect: 'error', signal: AbortSignal.timeout(IMAGE_REQUEST_TIMEOUT_MS) });
    } catch {
      // No url or error detail in the message: a signed download URL must not leak.
      throw new Error('Image download failed (network error or disallowed redirect).');
    }
    if (!response.ok) throw new Error(`Image download returned ${response.status}.`);
    const declared = Number(response.headers?.get?.('content-length'));
    if (Number.isFinite(declared) && declared > this.maxBytes) throw new Error('Image download exceeds the size cap.');
    return readCapped(response, this.maxBytes);
  }
}

export function createArtifactProvider(mode = 'mock', env = process.env) {
  return mode === 'image' ? new ImageArtifactProvider(env) : new MockArtifactProvider();
}

// A full artist provider for the studio interface: deterministic for every text
// and review role, with artifact generation delegated to the chosen adapter.
export class StudioArtistProvider extends DeterministicProvider {
  constructor(mode = 'mock', env = process.env) {
    super();
    this.artifactAdapter = createArtifactProvider(mode, env);
  }

  get artifactMode() { return this.artifactAdapter.mode; }
  get artifactExtension() { return this.artifactAdapter.fileExtension; }

  async generateArtifact(input) {
    return this.artifactAdapter.generateArtifact(input);
  }
}
