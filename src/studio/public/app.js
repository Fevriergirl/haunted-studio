'use strict';

const $ = (id) => document.getElementById(id);
let currentCycleId = null;
let currentMode = 'mock';

async function api(method, path, body) {
  const response = await fetch(path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || `Something went wrong (${response.status}).`);
  return data;
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]));
}

// --- Mode + key ----------------------------------------------------------

function setMode(mode) {
  currentMode = mode === 'image' ? 'image' : 'mock';
  document.querySelectorAll('#mode-toggle button').forEach((b) => b.classList.toggle('active', b.dataset.mode === currentMode));
  $('image-setup').classList.toggle('hidden', currentMode !== 'image');
  const banner = $('mode-banner');
  if (currentMode === 'image') { banner.textContent = 'REAL IMAGE MODE'; banner.className = 'mode-image'; }
  else { banner.textContent = 'PRACTICE MODE'; banner.className = 'mode-mock'; }
}

function setKeyStatus(present) {
  const el = $('key-status');
  el.textContent = present ? 'key: saved ✓' : 'key: not saved';
  el.className = present ? 'ok' : 'muted';
}

async function setKey() {
  const key = $('image-key').value.trim();
  if (!key) { $('test-result').textContent = 'Paste your key first.'; $('test-result').className = 'bad'; return; }
  try {
    const r = await api('POST', '/api/image/key', { key });
    setKeyStatus(r.image_key_present);
    $('image-key').value = ''; // don't keep the key on the page
    $('test-result').textContent = 'Key saved on this computer.';
    $('test-result').className = 'ok';
  } catch (e) { $('test-result').textContent = e.message; $('test-result').className = 'bad'; }
}

async function clearKey() {
  try { const r = await api('POST', '/api/image/key/clear'); setKeyStatus(r.image_key_present); } catch { /* ignore */ }
  $('test-result').textContent = 'Key forgotten.';
  $('test-result').className = 'muted';
}

async function testConnection() {
  $('test-result').textContent = 'checking…';
  $('test-result').className = 'muted';
  try {
    const r = await api('POST', '/api/image/test');
    if (r.ok) { $('test-result').textContent = 'Works ✓'; $('test-result').className = 'ok'; }
    else { $('test-result').textContent = r.error || 'Could not connect.'; $('test-result').className = 'bad'; }
  } catch (e) { $('test-result').textContent = e.message; $('test-result').className = 'bad'; }
}

// --- Make a piece --------------------------------------------------------

function decisionButtons(enabled) {
  document.querySelectorAll('[data-decision]').forEach((button) => { button.disabled = !enabled; });
}

function showError(message) {
  let text = message;
  if (/Maximum cycle budget reached/i.test(message)) {
    text = "You've reached this studio's limit of pieces. Run `npm run reset` in the terminal to start a fresh studio.";
  } else if (/image API key/i.test(message)) {
    text = 'Save your image AI key above first (or switch to Practice mode).';
  } else if (/incomplete cycle/i.test(message)) {
    text = 'The studio was interrupted partway through an earlier piece. Run `npm run reset` in the terminal to start fresh — the record is archived, never erased.';
  }
  $('error').textContent = text;
}

async function beginCycle() {
  $('error').textContent = '';
  const seed = $('seed').value.trim();
  if (!seed) { showError('Type an idea first.'); $('seed').focus(); return; }
  $('begin').disabled = true;
  $('begin').textContent = 'Making…';
  decisionButtons(false);
  $('decision-result').textContent = '';
  const body = { seed, mode: currentMode };
  if (currentMode === 'image' && $('image-model').value.trim()) body.model = $('image-model').value.trim();
  try {
    const cycle = await api('POST', '/api/cycle', body);
    currentCycleId = cycle.cycle_id;
    await liveIdle(); // let the live story finish unfolding before the reveal
    $('result').classList.remove('hidden');
    $('result-idea').textContent = cycle.seed || seed;
    $('result-goal').textContent = cycle.artist_brief || 'The studio set this piece aside.';
    $('result-image').alt = cycle.artist_brief
      ? `The picture the studio made. Its aim: ${cycle.artist_brief}`
      : 'the art that was made';
    if (cycle.artifact_url) {
      $('result-image').src = cycle.artifact_url;
      $('result-image').classList.remove('hidden');
      $('saved-line').textContent = cycle.metadata?.artifact_path ? `Saved in the project at ${cycle.metadata.artifact_path}` : '';
    } else {
      $('result-image').classList.add('hidden');
      $('saved-line').textContent = '';
    }
    decisionButtons(Boolean(cycle.artifact_url));
    renderState(cycle.state);
    await loadProcess(currentCycleId);
  } catch (error) {
    showError(error.message);
  } finally {
    $('begin').disabled = false;
    $('begin').textContent = 'Make art';
  }
}

async function decide(decision) {
  if (!currentCycleId) return;
  decisionButtons(false);
  const label = { accept: 'Kept', reject: 'Discarded', unresolved: 'Marked “not sure”' }[decision] || decision;
  try {
    const result = await api('POST', `/api/cycle/${currentCycleId}/decision`, { decision });
    $('decision-result').textContent = `${label}. ✓`;
    $('decision-result').className = 'field ok';
    renderState(result.state);
    await loadProcess(currentCycleId);
  } catch (error) {
    $('decision-result').textContent = error.message;
    $('decision-result').className = 'field bad';
    decisionButtons(true);
  }
}

// --- The studio so far ---------------------------------------------------

function renderState(state) {
  const canon = state?.canon ?? [];
  const kept = canon.filter((work) => !work.revoked);
  const removed = canon.filter((work) => work.revoked);
  const html = [];
  html.push(`<p class="kept-line"><strong>${kept.length}</strong> piece${kept.length === 1 ? '' : 's'} kept`
    + (removed.length ? ` · <strong>${removed.length}</strong> later removed` : '')
    + ` · <strong>${state?.cycle_count ?? 0}</strong> made in total</p>`);
  canon.slice().reverse().forEach((work) => {
    const cls = work.revoked ? 'piece removed' : 'piece';
    const title = work.title ?? work.cycle_id ?? 'untitled';
    const tail = work.revoked ? ' — removed by a later honesty check (record kept)' : '';
    html.push(`<div class="${cls}">${escapeHtml(title)}${escapeHtml(tail)}</div>`);
  });
  $('state').innerHTML = html.join('');
}

// --- How it was made: plain story + verified record ----------------------

// One friendly sentence per meaningful step, in the order they happened.
const STORY_LINES = {
  cycle_started: 'Opened a new cycle.',
  observation_selected: 'Looked closely at your idea.',
  intention_locked: 'Decided what it was trying to do — and locked that in, so the result can be judged honestly.',
  candidates_generated: 'Sketched a few different directions.',
  critics_reported: 'Critiqued each direction.',
  candidate_revised: 'Reworked the most promising one.',
  curation_decided: 'Chose which one to actually make.',
  artifact_generated: 'Made the picture.',
  artifact_witnessed: 'A separate reviewer described what is actually in the picture — without being told what the artist intended.',
  artifact_deviations_compared: 'Compared the result against the original plan.',
  surprise_reviewed: 'Checked whether anything surprising was genuinely good or just a fluke.',
  artifact_audited: 'Reviewed the finished picture for quality.',
  audience_predicted: 'Predicted what a viewer would notice, and might misread.',
  memory_consolidated: 'Remembered what it learned for next time.',
  cycle_completed: 'Finished and saved the whole record.',
  artifact_decision_recorded: 'Recorded your decision.',
  canon_revoked_by_fidelity: 'A later honesty check removed this piece from your kept set (the record is kept, never erased).'
};

function renderStory(events) {
  const seen = new Set();
  const lines = [];
  for (const event of events) {
    const line = STORY_LINES[event.type];
    if (line && !seen.has(event.type)) { seen.add(event.type); lines.push(line); }
  }
  $('story').innerHTML = lines.map((line) => `<li>${escapeHtml(line)}</li>`).join('');
}

function shortHash(value) {
  const s = String(value ?? '');
  return s ? (s.length > 12 ? `${s.slice(0, 8)}…` : s) : '—';
}

function roleLabel(actor) {
  const map = {
    'role:attention': 'Attention', 'role:artist': 'Artist', 'role:critics': 'Critics',
    'role:curator': 'Curator', 'role:editor': 'Editor', 'role:artifact-witness': 'Blind witness',
    'role:deviation-comparator': 'Plan checker', 'role:adversarial-surprise-reviewer': 'Skeptic',
    'visual-critic': 'Visual critic', 'role:audience-prediction': 'Audience model', 'role:memory': 'Memory',
    'image-provider': 'Image maker', 'orchestrator': 'Orchestrator', 'experiment-orchestrator': 'Studio rules'
  };
  return map[actor] ?? String(actor ?? 'step').replace(/^role:/, '');
}

function renderProvenance(events) {
  $('provenance').innerHTML = '<ul class="trail">' + events.map((event) => {
    const title = (STORY_LINES[event.type] ? '' : '') + event.type.replace(/_/g, ' ');
    return '<li class="trail-item">'
      + `<div><span class="trail-role">${escapeHtml(roleLabel(event.actor))}</span>`
      + `<span class="trail-title">${escapeHtml(title)}</span></div>`
      + `<div class="trail-hash">#${event.sequence} · ${shortHash(event.previous_hash)} → ${shortHash(event.hash)}</div>`
      + '</li>';
  }).join('') + '</ul>';
}

async function loadProcess(cycleId) {
  if (!cycleId) return;
  try {
    const data = await api('GET', `/api/cycle/${cycleId}/provenance`);
    if (!Array.isArray(data.events) || data.events.length === 0) return;
    $('how').classList.remove('hidden');
    renderStory(data.events);
    renderProvenance(data.events);
    const v = data.verification ?? {};
    const verified = $('verified');
    if (v.valid) { verified.textContent = `Every step above was recorded in order and checked for tampering — verified ✓ (${v.count} steps).`; verified.className = 'verified'; }
    else { verified.textContent = `Warning: the record failed its tamper check (${v.error || 'unknown'}).`; verified.className = 'verified bad'; }
  } catch { /* ignore */ }
}

// --- Live view: the studio showing itself work in real time ---------------
//
// /api/live streams every ledger append the moment it is persisted, so this
// panel fills in step by step WHILE a cycle runs — including cycles started
// from the terminal, not just from this page.

const LIVE_LINES = {
  curation_overridden_by_condition: 'This studio is set to always finish a picture, so it went ahead — the curator’s original call stays in the record.',
  artifact_audit_not_passed: 'The quality review declined to pass the finished picture.',
  post_result_evidence_unavailable: 'No picture was generated, so there was nothing for the independent reviewers to inspect.',
  cycle_failed: 'The cycle stopped with an error (recorded, never hidden).'
};

// Plain words for recorded decision values (never shown as raw enums).
const DECISION_WORDS = {
  accept: 'accepted', revise: 'sent back for revision', reject_all: 'rejected all',
  reject: 'discarded', unresolved: 'not sure yet'
};
function decisionWord(decision) {
  return DECISION_WORDS[decision] ?? String(decision ?? '').replace(/_/g, ' ');
}

// The curator's line must follow the curator's actual decision.
function liveLine(event) {
  if (event.type === 'curation_decided') {
    const decision = event.payload?.decision;
    if (decision === 'revise') return 'Sent the most promising one back for another pass.';
    if (decision === 'reject_all') return 'Decided none of them were good enough yet.';
    return 'Chose which one to actually make.';
  }
  return STORY_LINES[event.type] ?? LIVE_LINES[event.type] ?? event.type.replace(/_/g, ' ');
}

// The cast strip: every role as a stage light, in the order a cycle visits
// them. Each actor maps to one light; the light comes on when its role works.
const CAST = [
  { key: 'attention', name: 'Attention', color: '#6ec8ff', actors: ['role:attention'] },
  { key: 'artist', name: 'Artist', color: '#b48cff', actors: ['role:artist', 'role:editor'] },
  { key: 'critics', name: 'Critics', color: '#ff9d6e', actors: ['role:critics'] },
  { key: 'curator', name: 'Curator', color: '#7ee2a8', actors: ['role:curator', 'experiment-orchestrator'] },
  { key: 'image', name: 'Image', color: '#f0d97e', actors: ['image-provider'] },
  { key: 'witness', name: 'Witness', color: '#8fb8ff', actors: ['role:artifact-witness'] },
  { key: 'comparator', name: 'Plan check', color: '#6ee2d8', actors: ['role:deviation-comparator'] },
  { key: 'reviewer', name: 'Review', color: '#ff8a8a', actors: ['role:adversarial-surprise-reviewer', 'visual-critic'] },
  { key: 'audience', name: 'Audience', color: '#f0a6c4', actors: ['role:audience-prediction'] },
  { key: 'memory', name: 'Memory', color: '#e2c07e', actors: ['role:memory'] }
];
const CAST_BY_ACTOR = new Map(CAST.flatMap((node) => node.actors.map((actor) => [actor, node])));

function roleColor(actor) {
  return CAST_BY_ACTOR.get(actor)?.color ?? '#9aa6ff';
}

function renderCast() {
  $('cast').innerHTML = CAST.map((node) =>
    `<div class="cast-node" role="listitem" data-cast="${node.key}" style="--role-color:${node.color}" title="${escapeHtml(node.name)} — lights up while this role works">`
    + '<span class="cast-dot"></span>'
    + `<span class="cast-name">${escapeHtml(node.name)}</span></div>`
  ).join('');
}

function lightCast(actor) {
  const node = CAST_BY_ACTOR.get(actor);
  document.querySelectorAll('.cast-node.now').forEach((el) => { el.classList.remove('now'); el.classList.add('done'); });
  if (!node) return;
  const el = document.querySelector(`.cast-node[data-cast="${node.key}"]`);
  if (el) { el.classList.remove('done'); el.classList.add('now'); }
}

function settleCast() {
  document.querySelectorAll('.cast-node.now').forEach((el) => { el.classList.remove('now'); el.classList.add('done'); });
}

function clip(text, max = 90) {
  const s = String(text ?? '').trim();
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

// The role's actual words for this step — the story, quoted from the record.
function liveQuote(event) {
  const p = event.payload ?? {};
  switch (event.type) {
    case 'observation_selected': return clip(p.reasons?.[0], 160);
    case 'intention_locked': return clip(p.necessity?.statement, 200);
    case 'candidates_generated': return clip((p.candidates ?? []).map((c) => c.title).filter(Boolean).join('  ·  '), 200);
    case 'critics_reported': return clip(p.critiques?.[0]?.strongest_objection, 200);
    case 'candidate_revised': return clip(p.revised_candidate?.revision_reason, 200);
    case 'curation_decided':
    case 'curation_overridden_by_condition':
      return clip(p.rationale, 200);
    case 'artifact_witnessed': return clip(p.observations?.[0]?.description, 200);
    case 'artifact_deviations_compared': return clip(p.comparisons?.[0]?.description, 200);
    case 'surprise_reviewed': return (p.reviewed_evidence ?? []).some((item) => item.review_status === 'confirmed')
      ? clip(p.reviewed_evidence.find((item) => item.review_status === 'confirmed')?.description, 200)
      : 'No claimed surprise survived adversarial review — flukes are not kept as achievements.';
    case 'artifact_audited': return clip(p.observations?.[0], 200);
    case 'audience_predicted': return clip(p.likely_misreading, 200);
    case 'memory_consolidated': return clip(p.lesson, 200);
    case 'cycle_failed': return clip(p.message, 200);
    default: return '';
  }
}

// One small, human peek into each step's payload.
function liveDetail(event) {
  const p = event.payload ?? {};
  switch (event.type) {
    case 'observation_selected': return clip(p.observation?.text);
    case 'intention_locked': return clip(p.intention?.about);
    case 'candidates_generated': return `${(p.candidates ?? []).length} directions`;
    case 'critics_reported': return `${(p.critiques ?? []).length} critiques`;
    case 'candidate_revised': return clip(p.revised_candidate?.title);
    case 'curation_decided':
    case 'curation_overridden_by_condition':
      return p.decision ? `${decisionWord(p.decision)}${p.score != null ? ` · score ${p.score}` : ''}` : '';
    case 'artifact_generated': return p.artifact_hash ? `image hash ${String(p.artifact_hash).slice(0, 10)}…` : '';
    case 'artifact_audited': return p.overall_score != null
      ? `score ${p.overall_score} → ${String(p.recommended_action ?? '').replace(/_/g, ' ')}`
      : clip(String(p.recommended_action ?? '').replace(/_/g, ' '));
    case 'audience_predicted': return clip(p.first_notice);
    case 'memory_consolidated': return clip((p.unresolved_tensions ?? []).at(-1));
    case 'cycle_completed': return p.canon_status ? `status: ${String(p.canon_status).replace(/_/g, ' ')}` : '';
    case 'cycle_failed': return clip(p.message);
    case 'artifact_decision_recorded': return p.decision ? `you ${p.decision === 'accept' ? 'kept it' : p.decision === 'reject' ? 'discarded it' : 'were not sure yet'}` : '';
    default: return '';
  }
}

function setLiveStatus(kind, text) {
  const status = $('live-status');
  status.className = kind;
  $('live-status-text').textContent = text;
}

function appendLiveStep(event) {
  const line = liveLine(event);
  const detail = liveDetail(event);
  const quote = liveQuote(event);
  const time = (() => { try { return new Date(event.timestamp).toLocaleTimeString(); } catch { return ''; } })();
  const item = document.createElement('li');
  item.className = 'live-step current';
  item.style.setProperty('--role-color', roleColor(event.actor));
  item.innerHTML = '<div class="live-head">'
    + `<span class="live-role">${escapeHtml(roleLabel(event.actor))}</span>`
    + `<span><span class="live-line">${escapeHtml(line)}</span>`
    + (detail ? ` <span class="live-detail">— ${escapeHtml(detail)}</span>` : '')
    + '</span>'
    + `<span class="live-time">${escapeHtml(time)}</span></div>`
    + (quote ? `<div class="live-quote">“${escapeHtml(quote)}”</div>` : '');
  const list = $('live-steps');
  list.querySelectorAll('.current').forEach((el) => el.classList.remove('current'));
  // Follow-along scroll: keep the story's leading edge in view, but only when
  // the viewer is already watching it — never yank the page away from someone
  // who scrolled off to read something else.
  const edge = list.lastElementChild;
  const following = !edge || (edge.getBoundingClientRect().bottom <= window.innerHeight + 40 && edge.getBoundingClientRect().bottom >= 0);
  list.appendChild(item);
  if (following && !REDUCED_MOTION && !document.hidden) item.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

// Pacing: a deterministic cycle can persist all of its steps in well under a
// second, and fifteen story beats landing in one frame read as a dump, not as
// work happening. Reveals are therefore queued and released one per beat, so
// the story unfolds legibly no matter how fast the engine ran. The queue only
// paces *presentation* — recorded timestamps are shown untouched, and slow
// (real-image) cycles are unaffected because their events arrive slower than
// the beat. Respects prefers-reduced-motion by dropping the delay entirely.
const REDUCED_MOTION = Boolean(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
const LIVE_BEAT_MS = REDUCED_MOTION ? 0 : 420;
const liveQueue = [];
let liveDraining = false;

function handleLiveEvent(event) {
  if (!event || typeof event.type !== 'string') return;
  liveQueue.push(event);
  if (!liveDraining) { liveDraining = true; drainLiveQueue(); }
}

function drainLiveQueue() {
  const event = liveQueue.shift();
  if (!event) { liveDraining = false; return; }
  revealLiveEvent(event);
  if (LIVE_BEAT_MS === 0) return drainLiveQueue();
  setTimeout(drainLiveQueue, LIVE_BEAT_MS);
}

// Resolves once every queued step has been revealed (immediately if the live
// stream never delivered anything, so the result never waits on a dead stream).
function liveIdle() {
  return new Promise((resolve) => {
    const check = () => ((liveDraining || liveQueue.length) ? setTimeout(check, 120) : resolve());
    check();
  });
}

function revealLiveEvent(event) {
  $('live').classList.remove('hidden');
  if (!$('cast').childElementCount) renderCast(); // joined mid-cycle: still show the cast
  if (event.type === 'cycle_started') {
    $('live-steps').innerHTML = '';
    renderCast();
    setLiveStatus('working', 'The studio is working…');
  }
  lightCast(event.actor);
  appendLiveStep(event);
  if (event.type === 'cycle_completed') { settleCast(); setLiveStatus('', 'Finished — every step above is in the permanent record.'); }
  if (event.type === 'cycle_failed') { settleCast(); setLiveStatus('failed', 'The cycle failed. The failure itself was recorded.'); }
}

function connectLive() {
  try {
    const source = new EventSource('/api/live');
    source.onmessage = (message) => {
      try { handleLiveEvent(JSON.parse(message.data)); } catch { /* ignore malformed frames */ }
    };
    // EventSource reconnects on its own; nothing to do on error.
  } catch { /* live view is an enhancement — the studio still works without it */ }
}

// --- Wire up -------------------------------------------------------------

async function init() {
  let config = { mode: 'mock', image_key_present: false, model: 'gpt-image-1' };
  try { config = await api('GET', '/api/config'); } catch { /* keep defaults */ }
  setMode(config.mode);
  setKeyStatus(config.image_key_present);
  if (config.model) $('image-model').value = config.model;

  document.querySelectorAll('#mode-toggle button').forEach((b) => b.addEventListener('click', () => setMode(b.dataset.mode)));
  // Ctrl/Cmd+Enter in the idea box makes the art, like sending a message.
  $('seed').addEventListener('keydown', (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter' && !$('begin').disabled) beginCycle();
  });
  $('set-key').addEventListener('click', setKey);
  $('clear-key').addEventListener('click', clearKey);
  $('test-conn').addEventListener('click', testConnection);
  $('begin').addEventListener('click', beginCycle);
  document.querySelectorAll('[data-decision]').forEach((button) =>
    button.addEventListener('click', () => decide(button.dataset.decision)));
  $('details-toggle').addEventListener('click', () => {
    const panel = $('provenance');
    const hidden = panel.classList.toggle('hidden');
    $('details-toggle').textContent = hidden ? 'Show the full record ▾' : 'Hide the full record ▴';
  });

  connectLive();
  try { renderState(await api('GET', '/api/state')); } catch { /* ignore */ }
}

init();
