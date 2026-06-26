// Artifact provider adapter — the seam that keeps image-generation logic out of
// the core engine. `mock` (default) produces a deterministic placeholder so the
// app works fully offline; `image` reads credentials from the environment and
// will call a real provider later.

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

// Calls an OpenAI-images-compatible endpoint. Credentials come only from the
// environment and are never logged, embedded in metadata, or returned in an
// error — every outward message is redacted.
export class ImageArtifactProvider {
  constructor(env = process.env, fetchImpl = globalThis.fetch) {
    this.apiKey = env.HAUNTED_STUDIO_IMAGE_API_KEY ?? null;
    this.baseUrl = (env.HAUNTED_STUDIO_IMAGE_BASE_URL ?? 'https://api.openai.com/v1').replace(/\/$/, '');
    this.model = env.HAUNTED_STUDIO_IMAGE_MODEL ?? 'gpt-image-2';
    this.size = env.HAUNTED_STUDIO_IMAGE_SIZE ?? '1024x1024';
    this.fetchImpl = fetchImpl;
  }

  get mode() { return 'image'; }
  get fileExtension() { return 'png'; }

  redact(text) {
    return this.apiKey ? String(text).replaceAll(this.apiKey, '[redacted]') : String(text);
  }

  async generateArtifact({ prompt, outputPath }) {
    if (!this.apiKey) {
      throw new Error('HAUNTED_STUDIO_IMAGE_API_KEY is required for image mode; run in mock mode to work without keys.');
    }
    let response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}/images/generations`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(IMAGE_REQUEST_TIMEOUT_MS),
        body: JSON.stringify({ model: this.model, prompt, size: this.size, output_format: 'png' })
      });
    } catch (error) {
      throw new Error(this.redact(`Image provider request failed: ${error.message}`));
    }
    if (!response.ok) {
      const body = this.redact((await response.text()).slice(0, 500));
      throw new Error(`Image provider returned ${response.status}: ${body}`);
    }
    const result = await response.json();
    const base64 = result?.data?.[0]?.b64_json;
    if (!base64) throw new Error('Image provider response did not contain base64 image data.');
    await ensureDir(path.dirname(outputPath));
    await writeFile(outputPath, Buffer.from(base64, 'base64'));
    return outputPath;
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
