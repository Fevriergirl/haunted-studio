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

  async generateArtifact({ prompt, outputPath }) {
    await ensureDir(path.dirname(outputPath));
    await writeFile(outputPath, mockArtifactSvg(prompt), 'utf8');
    return outputPath;
  }
}

export class ImageArtifactProvider {
  constructor(env = process.env) {
    this.apiKey = env.HAUNTED_STUDIO_IMAGE_API_KEY ?? null;
    this.baseUrl = env.HAUNTED_STUDIO_IMAGE_BASE_URL ?? null;
    this.model = env.HAUNTED_STUDIO_IMAGE_MODEL ?? null;
  }

  get mode() { return 'image'; }

  async generateArtifact() {
    if (!this.apiKey) {
      throw new Error('HAUNTED_STUDIO_IMAGE_API_KEY is required for image mode; run in mock mode to work without keys.');
    }
    // The credential seam exists now; the real call is wired in a later slice.
    throw new Error('Image-mode artifact generation is not yet implemented; use mock mode.');
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

  async generateArtifact(input) {
    return this.artifactAdapter.generateArtifact(input);
  }
}
