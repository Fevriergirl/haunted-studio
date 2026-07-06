// Build the public exhibition: a self-contained static site showing the
// artist's trajectory — every work in order, with its intention, criticism,
// curator decision, and ledger provenance — and the cast of role-separated
// agents behind it, drawn as deterministic geometric portraits so the
// navigation itself tells the story of one creative cycle.
// Zero dependencies; composes only existing engine functions.
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
// Live when an image provider is configured (the workflow sets this from the
// repository secret); otherwise the reproducible practice season.
const LIVE = process.env.HAUNTED_STUDIO_ARTIFACT === 'image';

// The cast — one entry per separated role, in the order of a creative cycle.
// Each portrait is a small inline SVG mark in the studio's own geometric
// language (the Artist's portrait is the circle-and-slash motif of the works).
const CAST = [
  {
    id: 'attention', name: 'The Attention', hue: 205,
    who: 'The one who notices. It selects a single observation from everything the studio has been given.',
    rule: 'It may choose — it may not invent.',
    mark: '<ellipse cx="40" cy="40" rx="25" ry="15" fill="none" stroke="MARK" stroke-width="3"/><circle cx="40" cy="40" r="7" fill="MARK"/>'
  },
  {
    id: 'artist', name: 'The Artist', hue: 45,
    who: 'The one who makes. It states why a work is necessary, locks that intention with a hash, then produces candidates.',
    rule: 'Its intention is sealed before it may touch the canvas.',
    mark: '<circle cx="43" cy="38" r="20" fill="MARK" opacity="0.9"/><rect x="18" y="52" width="44" height="5" fill="MARK" opacity="0.5" transform="rotate(-8 40 54)"/>'
  },
  {
    id: 'critic', name: 'The Critic', hue: 5,
    who: 'The one who objects. It attacks every candidate against the locked intention, the constitution, and the history.',
    rule: 'It may demote a work — it may never promote one.',
    mark: '<path d="M16 56 L32 24 L44 46 L64 20" fill="none" stroke="MARK" stroke-width="4" stroke-linejoin="miter"/>'
  },
  {
    id: 'curator', name: 'The Curator', hue: 275,
    who: 'The one who decides. Accept, allow one revision, or refuse everything — an empty frame is a legal outcome.',
    rule: 'One revision, then the decision stands forever.',
    mark: '<rect x="20" y="20" width="40" height="40" fill="none" stroke="MARK" stroke-width="3"/><circle cx="40" cy="40" r="5" fill="MARK"/>'
  },
  {
    id: 'witness', name: 'The Blind Witness', hue: 160,
    who: 'The one who looks without knowing. It describes the finished work while sealed off from the plan, so deviations cannot hide.',
    rule: 'It sees the result — never the intention.',
    mark: '<path d="M15 38 Q40 56 65 38" fill="none" stroke="MARK" stroke-width="3"/><line x1="28" y1="48" x2="24" y2="56" stroke="MARK" stroke-width="3"/><line x1="40" y1="51" x2="40" y2="60" stroke="MARK" stroke-width="3"/><line x1="52" y1="48" x2="56" y2="56" stroke="MARK" stroke-width="3"/>'
  },
  {
    id: 'adjudicator', name: 'The Surprise Adjudicator', hue: 25,
    who: 'The one who doubts wonder. Any claimed surprise is challenged adversarially before it may enter the record.',
    rule: 'Astonishment must survive cross-examination.',
    mark: '<rect x="26" y="26" width="28" height="28" fill="none" stroke="MARK" stroke-width="3" transform="rotate(45 40 40)"/><line x1="40" y1="30" x2="40" y2="44" stroke="MARK" stroke-width="4"/><circle cx="40" cy="52" r="2.5" fill="MARK"/>'
  },
  {
    id: 'audience', name: 'The Audience Oracle', hue: 320,
    who: 'The one who imagines you. It predicts how people might meet the work — kept strictly apart from what real people actually say.',
    rule: 'Its guesses may never impersonate a human voice.',
    mark: '<circle cx="26" cy="46" r="6" fill="MARK"/><circle cx="40" cy="30" r="6" fill="MARK" opacity="0.85"/><circle cx="54" cy="46" r="6" fill="MARK"/><circle cx="33" cy="58" r="4" fill="MARK" opacity="0.6"/><circle cx="47" cy="58" r="4" fill="MARK" opacity="0.6"/>'
  },
  {
    id: 'ledger', name: 'The Ledger', hue: 105,
    who: 'The memory no one can edit. Every step above is chained by SHA-256 hashes, failures included, forever.',
    rule: 'It only ever grows — nothing is unwritten.',
    mark: '<rect x="14" y="32" width="15" height="15" fill="none" stroke="MARK" stroke-width="3"/><rect x="33" y="32" width="15" height="15" fill="none" stroke="MARK" stroke-width="3"/><rect x="52" y="32" width="15" height="15" fill="none" stroke="MARK" stroke-width="3"/><line x1="29" y1="40" x2="33" y2="40" stroke="MARK" stroke-width="3"/><line x1="48" y1="40" x2="52" y2="40" stroke="MARK" stroke-width="3"/>'
  }
];

// One short label per ledger event type, and which cast member acted, so the
// full recorded process — not just the six curated highlights above — can be
// shown per work: the same live, role-separated action visible in the studio.
const STEP_LABEL = {
  cycle_started: 'Began the cycle.',
  observation_selected: 'Noticed this observation.',
  intention_locked: 'Locked the intention before making anything.',
  candidates_generated: 'Sketched several candidate directions.',
  critics_reported: 'Critiqued every candidate.',
  candidate_revised: 'Reworked the strongest candidate.',
  revision_critiqued: 'Critiqued the reworked candidate.',
  curation_decided: 'Decided which candidate to make.',
  curation_overridden_by_condition: 'An experimental condition overrode the curator.',
  artifact_generated: 'Generated the image file.',
  artifact_witnessed: 'A blind witness described the result without seeing the plan.',
  artifact_deviations_compared: 'Compared the result against the locked plan.',
  surprise_reviewed: 'Put any claimed surprise through adversarial cross-examination.',
  artifact_audited: 'Audited the finished image for quality.',
  artifact_audit_not_passed: 'The audit did not clear the canon threshold.',
  post_result_evidence_unavailable: 'No artifact was made, so no post-result evidence applies.',
  audience_predicted: 'Predicted how an audience might meet the work.',
  memory_consolidated: 'Folded what it learned into memory.',
  cycle_completed: 'Sealed the whole record in the ledger.'
};

const ACTOR_CAST_ID = {
  'role:attention': 'attention', 'role:artist': 'artist', 'role:editor': 'artist',
  'role:critics': 'critic', 'role:curator': 'curator', 'experiment-orchestrator': 'curator',
  'role:artifact-witness': 'witness', 'role:deviation-comparator': 'witness',
  'role:adversarial-surprise-reviewer': 'adjudicator', 'visual-critic': 'curator',
  'role:audience-prediction': 'audience', 'orchestrator': 'ledger', 'image-provider': 'ledger'
};

function stepList(events) {
  if (!events.length) return '';
  const items = events.map((event) => {
    const label = STEP_LABEL[event.type] ?? event.type.replace(/_/g, ' ');
    return `<li>${glyph(ACTOR_CAST_ID[event.actor])} ${esc(label)} <span class="stephash">#${event.sequence}</span></li>`;
  }).join('');
  return `<details class="livetrail">
    <summary>See every recorded step, in order — the full process</summary>
    <ol class="steps">${items}</ol>
  </details>`;
}

function esc(value) {
  return String(value ?? '—').replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));
}

function portrait(member, size) {
  const mark = member.mark.replaceAll('MARK', `hsl(${member.hue} 55% 58%)`);
  return `<svg width="${size}" height="${size}" viewBox="0 0 80 80" role="img" aria-label="${esc(member.name)}">
    <rect width="80" height="80" rx="10" fill="hsl(${member.hue} 30% 13%)" stroke="hsl(${member.hue} 25% 28%)"/>${mark}</svg>`;
}

function glyph(id, size = 17) {
  const member = CAST.find((c) => c.id === id);
  return member ? `<span class="glyph">${portrait(member, size)}</span>` : '';
}

function nav() {
  const chain = CAST.map((member) =>
    `<a href="#cast-${member.id}" title="${esc(member.name)}">${portrait(member, 30)}</a>`
  ).join('<span class="arrow">→</span>');
  return `<nav>
    <a class="brand" href="#top">Haunted Studio</a>
    <div class="cycle" aria-label="One creative cycle, in order">${chain}</div>
    <div class="navlinks"><a href="#cast">the studio</a><a href="#works">the works</a><a href="#record">the record</a></div>
  </nav>`;
}

function castSection() {
  const cards = CAST.map((member) => `<div class="member" id="cast-${member.id}">
      <div class="portrait">${portrait(member, 64)}</div>
      <div><h3>${esc(member.name)}</h3>
      <p>${esc(member.who)}</p>
      <p class="rule">${esc(member.rule)}</p></div>
    </div>`).join('\n');
  return `<section id="cast">
    <h2>The studio — eight roles, strictly separated</h2>
    <p class="castlede">This is not one AI pretending to be many. Each role sees only what its job allows, so no one
    grades their own work. The strip in the navigation above is one creative cycle, in order — click any face to meet
    that role.</p>
    <div class="cast">${cards}</div>
  </section>`;
}

// Innovation: the provenance strip — the work's ledger painted as brushstrokes.
// One stroke per event, in order; color derived from the acting role, height
// carved from the event's own hash. Tamper with history and the painting changes.
function actorHue(actor) {
  let sum = 0;
  for (const ch of String(actor ?? 'system')) sum = (sum + ch.charCodeAt(0) * 37) % 360;
  return sum;
}

function ledgerStrip(events) {
  if (!events.length) return '';
  const strokes = events.map((event, i) => {
    const byte = parseInt(String(event.hash ?? '00').slice(0, 2), 16) || 0;
    const height = 8 + Math.round((byte / 255) * 14);
    return `<rect x="${i * 8}" y="${24 - height}" width="6" height="${height}" fill="hsl(${actorHue(event.actor)} 55% 55%)"><title>${esc(event.type)} — ${esc(event.actor)}</title></rect>`;
  }).join('');
  return `<div class="strip"><svg viewBox="0 0 ${events.length * 8} 24" preserveAspectRatio="none" role="img"
    aria-label="This work's ledger, painted: one stroke per event, colored by role">${strokes}</svg>
    <span>This work's ledger, painted — one stroke per recorded step, in order, colored by the role that acted.
    Hover a stroke to name it. Edit history and this painting breaks.</span></div>`;
}

function card(cycle, index, eventsByCycle) {
  const meta = cycle.metadata;
  const reflection = meta?.reflection ?? {};
  const image = cycle.artifact_url
    ? `<img src="${esc(cycle.artifact_url.replace(/^\//, ''))}" alt="Artwork for: ${esc(cycle.seed)}" loading="lazy">`
    : '<div class="refused">The curator refused every candidate. The empty frame is part of the record.</div>';
  const reactTitle = encodeURIComponent(`Reaction to work ${index + 1}: ${cycle.seed}`);
  return `<article class="work">
    <div class="frame">${image}${ledgerStrip(eventsByCycle.get(cycle.cycle_id) ?? [])}</div>
    <div class="about">
      <h3>${index + 1}. ${esc(cycle.seed)}</h3>
      <p class="intent">${glyph('artist')} <strong>The Artist's intention.</strong> ${esc(cycle.artist_brief)}</p>
      <details>
        <summary>How this was made — and who pushed back</summary>
        <dl>
          <dt>${glyph('attention')} What The Attention noticed</dt><dd>${esc(cycle.seed)}</dd>
          <dt>${glyph('artist')} Prompt The Artist locked before making anything</dt><dd>${esc(cycle.generated_prompt)}</dd>
          <dt>${glyph('critic')} The Critic's strongest objection</dt><dd>${esc(reflection.strongest_objection)}</dd>
          <dt>${glyph('witness')} What The Blind Witness saw</dt><dd>${esc(reflection.truth_read)}</dd>
          <dt>${glyph('curator')} The Curator's decision</dt><dd>${esc(cycle.curator_decision)} (${esc(cycle.canon_status)})</dd>
          <dt>${glyph('adjudicator')} Constraints in force</dt><dd>role separation; locked intention (hashed before creation); independent criticism; one revision maximum; append-only memory</dd>
          <dt>${glyph('ledger')} Permanent record</dt><dd>${(meta?.ledger_event_ids ?? []).length} ledger events, hash-chained; see <code>metadata.json</code> in the repository run data</dd>
        </dl>
        ${stepList(eventsByCycle.get(cycle.cycle_id) ?? [])}
      </details>
      <p class="react">${glyph('audience')} <a href="${REPO}/issues/new?title=${reactTitle}&labels=audience-review">React to this work →</a>
      Reactions can be recorded into the studio's permanent memory as consented human reviews — they become part of what the artist faces next.</p>
    </div>
  </article>`;
}

function page({ cycles, verification, state, eventsByCycle }) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Haunted Studio — the trajectory of an artificial artist</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; margin: 0; }
  html { scroll-behavior: smooth; }
  body { background: #101014; color: #e8e6e1; font: 17px/1.6 Georgia, 'Times New Roman', serif; }
  nav { position: sticky; top: 0; z-index: 5; display: flex; flex-wrap: wrap; align-items: center; gap: 14px;
        padding: 10px 24px; background: rgba(16,16,20,0.94); border-bottom: 1px solid #2c2b31; }
  .brand { font-weight: bold; text-decoration: none; color: #e8e6e1; margin-right: 6px; }
  .cycle { display: flex; align-items: center; gap: 5px; }
  .cycle a { display: block; line-height: 0; border-radius: 6px; }
  .cycle a:hover { outline: 2px solid #9fb4c7; }
  .arrow { color: #5a5861; font-size: 12px; }
  .navlinks { margin-left: auto; display: flex; gap: 14px; font-size: 15px; }
  header, main, footer, #cast { max-width: 880px; margin: 0 auto; padding: 24px; }
  header { padding-top: 48px; }
  h1 { font-size: 34px; line-height: 1.2; }
  h2 { font-size: 24px; }
  .lede { color: #b9b5ac; margin-top: 16px; }
  .honest { border-left: 3px solid #8a7a4d; padding: 10px 14px; margin-top: 20px; color: #cfc9a8; background: #17161a; }
  .castlede { color: #b9b5ac; margin: 10px 0 20px; }
  .cast { display: grid; grid-template-columns: repeat(auto-fill, minmax(340px, 1fr)); gap: 18px; }
  .member { display: flex; gap: 14px; background: #17161a; border: 1px solid #2c2b31; border-radius: 10px;
            padding: 14px; scroll-margin-top: 70px; }
  .member h3 { font-size: 18px; margin-bottom: 4px; }
  .member p { font-size: 15px; color: #cfccc5; }
  .member .rule { margin-top: 6px; color: #8a7a4d; font-style: italic; }
  .portrait { flex: 0 0 auto; }
  .glyph svg { vertical-align: -3px; }
  .work { display: grid; grid-template-columns: minmax(220px, 340px) 1fr; gap: 22px; margin: 44px 0; }
  @media (max-width: 700px) { .work { grid-template-columns: 1fr; } }
  .frame img { width: 100%; border: 1px solid #2c2b31; display: block; }
  .strip { margin-top: 8px; }
  .strip svg { width: 100%; height: 24px; display: block; background: #17161a; border: 1px solid #2c2b31; }
  .strip span { display: block; font-size: 12.5px; color: #8f8b83; margin-top: 5px; line-height: 1.45; }
  .refused { border: 1px dashed #6a5555; padding: 40px 16px; color: #b08a8a; text-align: center; font-style: italic; }
  .work h3 { font-size: 20px; margin-bottom: 8px; }
  .intent { color: #cfccc5; }
  details { margin-top: 12px; }
  summary { cursor: pointer; color: #9fb4c7; }
  dl { margin: 10px 0 0; font-size: 15px; }
  dt { color: #8f8b83; margin-top: 8px; }
  dd { margin: 0; }
  .livetrail { margin-top: 14px; }
  .livetrail summary { font-size: 14px; }
  .steps { margin: 10px 0 0; padding-left: 20px; font-size: 14.5px; color: #cfccc5; }
  .steps li { margin: 4px 0; }
  .stephash { color: #6f6b64; font-size: 12px; }
  .react { margin-top: 12px; font-size: 15px; color: #b9b5ac; }
  a { color: #9fb4c7; }
  .proof { background: #17161a; border: 1px solid #2c2b31; padding: 18px; margin-top: 40px; scroll-margin-top: 70px; }
  .proof h2 { font-size: 20px; margin-bottom: 8px; }
  footer { color: #8f8b83; font-size: 15px; padding-bottom: 64px; }
</style>
</head>
<body id="top">
${nav()}
<header>
  <h1>Haunted Studio</h1>
  <p class="lede">An artificial artist with a memory it cannot rewrite. Every work below came from the same
  disciplined loop: the artist notices something, states why a work is necessary, locks that intention with a
  cryptographic hash <em>before</em> making anything, makes the work, faces an independent critic and a blind
  witness, and submits to a curator who can accept or refuse. Everything — including failures — is written to an
  append-only ledger that anyone can verify. The research question: does a history you cannot edit change what an
  artificial artist makes next?</p>
  <p class="honest"><strong>Honest label.</strong> ${LIVE
    ? `The images below are real, model-generated artworks commissioned live by the studio's process — each made
  only after its intention was hash-locked, then audited against the actual file. In this public run the written
  roles (intention, criticism, witness) still speak through the studio's deterministic engine; live-model minds
  for those roles are a future season, and this label will say so when they arrive.`
    : `This opening exhibition is a reproducible practice run: the
  artworks are deterministic placeholders generated by the studio's offline provider, shown to demonstrate the
  process and the record-keeping — not artistic ability. When the studio's live season begins, real model-generated
  works will appear here under the same rules, and this label will say so.`}</p>
</header>
${castSection()}
<main id="works">
  ${cycles.map((cycle, index) => card(cycle, index, eventsByCycle)).join('\n')}
  <section class="proof" id="record">
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
  cycles.push(await beginStudioCycle({ studio, seed, mode: LIVE ? 'image' : 'mock' }));
}
const verification = await studio.ledger.verify();
const state = await studio.getState();
const eventsByCycle = new Map();
for (const event of await studio.ledger.readAll()) {
  if (!event.cycle_id) continue;
  if (!eventsByCycle.has(event.cycle_id)) eventsByCycle.set(event.cycle_id, []);
  eventsByCycle.get(event.cycle_id).push(event);
}

await mkdir(OUT, { recursive: true });
for (const cycle of cycles) {
  if (!cycle.metadata?.artifact_path || !cycle.artifact_url) continue;
  const source = path.join(config.studioRoot, cycle.metadata.artifact_path);
  const destination = path.join(OUT, cycle.artifact_url.replace(/^\//, ''));
  await mkdir(path.dirname(destination), { recursive: true });
  await writeFile(destination, await readFile(source));
}
await writeFile(path.join(OUT, 'index.html'), page({ cycles, verification, state, eventsByCycle }), 'utf8');
console.log(`Exhibition built: ${OUT} (${cycles.length} works, ${CAST.length} cast members, ${LIVE ? 'LIVE images' : 'practice'}, ledger ${verification.valid ? 'valid' : 'INVALID'}, ${verification.count} events)`);
