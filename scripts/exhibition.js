// Build the public exhibition: a self-contained static site showing the
// artist's trajectory — every work in order, with its intention, criticism,
// curator decision, and ledger provenance. Zero dependencies; composes only
// existing engine functions, exactly like scripts/demo.js.
//
// Usage: HAUNTED_STUDIO_HOME=.haunted-studio-exhibition node scripts/exhibition.js
// Output: exhibition-site/ (deployable as-is to GitHub Pages)

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { loadProjectConfig } from '../src/config.js';
import { Studio } from '../src/core/studio.js';
import { beginStudioCycle } from '../src/engine/studio-cycle.js';

// ponytail: fixed seed list — a curated season, not a config system.
const SEEDS = [
  'a repaired clock that keeps two incompatible times',
  'the chair that remembers everyone who refused to sit',
  'a hallway that is longer on the way back',
  'the last light left on in an emptied building',
  'a door painted on the wall by someone who needed it',
  'the sound a photograph makes when no one looks at it',
  'a garden planted in the shadow of a demolished house',
  'the letter that was addressed but never weighed',
  'a mirror that returns the room five seconds late',
  'the seam where two wallpapers disagree about the year'
];

const REPO = 'https://github.com/Fevriergirl/haunted-studio';
const OUT = path.resolve('exhibition-site');

function esc(value) {
  return String(value ?? '—').replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));
}

function card(cycle, index) {
  const meta = cycle.metadata;
  const reflection = meta?.reflection ?? {};
  const image = cycle.artifact_url
    ? `<img src="${esc(cycle.artifact_url.replace(/^\//, ''))}" alt="Artwork for: ${esc(cycle.seed)}" loading="lazy">`
    : '<div class="refused">The curator refused every candidate. The empty frame is part of the record.</div>';
  const reactTitle = encodeURIComponent(`Reaction to work ${index + 1}: ${cycle.seed}`);
  return `<article class="work">
    <div class="frame">${image}</div>
    <div class="about">
      <h3>${index + 1}. ${esc(cycle.seed)}</h3>
      <p class="intent"><strong>The artist's intention.</strong> ${esc(cycle.artist_brief)}</p>
      <details>
        <summary>How this was made — and who pushed back</summary>
        <dl>
          <dt>Prompt the artist locked before making anything</dt><dd>${esc(cycle.generated_prompt)}</dd>
          <dt>The critic's strongest objection</dt><dd>${esc(reflection.strongest_objection)}</dd>
          <dt>What the blind witness saw</dt><dd>${esc(reflection.truth_read)}</dd>
          <dt>Curator's decision</dt><dd>${esc(cycle.curator_decision)} (${esc(cycle.canon_status)})</dd>
          <dt>Constraints in force</dt><dd>role separation; locked intention (hashed before creation); independent criticism; one revision maximum; append-only memory</dd>
          <dt>Permanent record</dt><dd>${(meta?.ledger_event_ids ?? []).length} ledger events, hash-chained; see <code>metadata.json</code> in the repository run data</dd>
        </dl>
      </details>
      <p class="react"><a href="${REPO}/issues/new?title=${reactTitle}&labels=audience-review">React to this work →</a>
      Reactions can be recorded into the studio's permanent memory as consented human reviews — they become part of what the artist faces next.</p>
    </div>
  </article>`;
}

function page({ cycles, verification, state }) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Haunted Studio — the trajectory of an artificial artist</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; margin: 0; }
  body { background: #101014; color: #e8e6e1; font: 17px/1.6 Georgia, 'Times New Roman', serif; }
  header, main, footer { max-width: 880px; margin: 0 auto; padding: 24px; }
  header { padding-top: 64px; }
  h1 { font-size: 34px; line-height: 1.2; }
  .lede { color: #b9b5ac; margin-top: 16px; }
  .honest { border-left: 3px solid #8a7a4d; padding: 10px 14px; margin-top: 20px; color: #cfc9a8; background: #17161a; }
  .work { display: grid; grid-template-columns: minmax(220px, 340px) 1fr; gap: 22px; margin: 44px 0; }
  @media (max-width: 700px) { .work { grid-template-columns: 1fr; } }
  .frame img { width: 100%; border: 1px solid #2c2b31; display: block; }
  .refused { border: 1px dashed #6a5555; padding: 40px 16px; color: #b08a8a; text-align: center; font-style: italic; }
  h3 { font-size: 20px; margin-bottom: 8px; }
  .intent { color: #cfccc5; }
  details { margin-top: 12px; }
  summary { cursor: pointer; color: #9fb4c7; }
  dl { margin: 10px 0 0; font-size: 15px; }
  dt { color: #8f8b83; margin-top: 8px; }
  dd { margin: 0; }
  .react { margin-top: 12px; font-size: 15px; color: #b9b5ac; }
  a { color: #9fb4c7; }
  .proof { background: #17161a; border: 1px solid #2c2b31; padding: 18px; margin-top: 40px; }
  .proof h2 { font-size: 20px; margin-bottom: 8px; }
  footer { color: #8f8b83; font-size: 15px; padding-bottom: 64px; }
</style>
</head>
<body>
<header>
  <h1>Haunted Studio</h1>
  <p class="lede">An artificial artist with a memory it cannot rewrite. Every work below came from the same
  disciplined loop: the artist notices something, states why a work is necessary, locks that intention with a
  cryptographic hash <em>before</em> making anything, makes the work, faces an independent critic and a blind
  witness, and submits to a curator who can accept or refuse. Everything — including failures — is written to an
  append-only ledger that anyone can verify. The research question: does a history you cannot edit change what an
  artificial artist makes next?</p>
  <p class="honest"><strong>Honest label.</strong> This opening exhibition is a reproducible practice run: the
  artworks are deterministic placeholders generated by the studio's offline provider, shown to demonstrate the
  process and the record-keeping — not artistic ability. When the studio's live season begins, real model-generated
  works will appear here under the same rules, and this label will say so.</p>
</header>
<main>
  ${cycles.map(card).join('\n')}
  <section class="proof">
    <h2>Why you can trust this record</h2>
    <p>Ledger verification at build time: <strong>${verification.valid ? 'VALID' : 'INVALID'}</strong> —
    ${verification.count} events in an unbroken SHA-256 hash chain across ${esc(state.cycle_count)} cycles.
    Each event names the one before it; editing history would break the chain visibly. The full code, ledger
    format, and evaluation standards are public: <a href="${REPO}">${REPO.replace('https://', '')}</a>.</p>
    <p>What would count as evidence that the trajectory is real — and what would count against it — is
    pre-committed in the project's <a href="${REPO}#research-question">research question</a> and experiment
    protocol. Interchangeable outputs, motifs that are mere branding, or surprises that never influence later
    work would weigh <em>against</em> the hypothesis. This page shows the record either way.</p>
  </section>
</main>
<footer>
  <p>Haunted Studio · MIT license · <a href="${REPO}">source &amp; ledger</a> ·
  built ${new Date().toISOString().slice(0, 10)} · role-separated, append-only, refusal-capable.</p>
</footer>
</body>
</html>`;
}

const config = await loadProjectConfig();
const studio = new Studio({ rootDir: config.studioRoot, constitution: config.constitution, experiment: config.experiment });
await studio.initialize();

const cycles = [];
for (const seed of SEEDS) {
  cycles.push(await beginStudioCycle({ studio, seed, mode: process.env.HAUNTED_STUDIO_ARTIFACT === 'image' ? 'image' : 'mock' }));
}
const verification = await studio.ledger.verify();
const state = await studio.getState();

await mkdir(OUT, { recursive: true });
for (const cycle of cycles) {
  if (!cycle.metadata?.artifact_path || !cycle.artifact_url) continue;
  const source = path.join(config.studioRoot, cycle.metadata.artifact_path);
  const destination = path.join(OUT, cycle.artifact_url.replace(/^\//, ''));
  await mkdir(path.dirname(destination), { recursive: true });
  await writeFile(destination, await readFile(source));
}
await writeFile(path.join(OUT, 'index.html'), page({ cycles, verification, state }), 'utf8');
console.log(`Exhibition built: ${OUT} (${cycles.length} works, ledger ${verification.valid ? 'valid' : 'INVALID'}, ${verification.count} events)`);
