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
  }
  $('error').textContent = text;
}

async function beginCycle() {
  $('error').textContent = '';
  const seed = $('seed').value.trim();
  if (!seed) { showError('Type an idea first.'); return; }
  $('begin').disabled = true;
  $('begin').textContent = 'Making…';
  decisionButtons(false);
  $('decision-result').textContent = '';
  const body = { seed, mode: currentMode };
  if (currentMode === 'image' && $('image-model').value.trim()) body.model = $('image-model').value.trim();
  try {
    const cycle = await api('POST', '/api/cycle', body);
    currentCycleId = cycle.cycle_id;
    $('result').classList.remove('hidden');
    $('result-idea').textContent = cycle.seed || seed;
    $('result-goal').textContent = cycle.artist_brief || 'The studio set this piece aside.';
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
    'role:curator': 'Curator', 'role:editor': 'Editor', 'role:artifact-witness': 'Witness · blind',
    'role:deviation-comparator': 'Deviation comparator', 'role:adversarial-surprise-reviewer': 'Adversarial reviewer',
    'visual-critic': 'Visual critic', 'role:audience-prediction': 'Audience model', 'role:memory': 'Memory',
    'image-provider': 'Image provider', 'orchestrator': 'Orchestrator', 'experiment-orchestrator': 'Experiment'
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

// --- Wire up -------------------------------------------------------------

async function init() {
  let config = { mode: 'mock', image_key_present: false, model: 'gpt-image-1' };
  try { config = await api('GET', '/api/config'); } catch { /* keep defaults */ }
  setMode(config.mode);
  setKeyStatus(config.image_key_present);
  if (config.model) $('image-model').value = config.model;

  document.querySelectorAll('#mode-toggle button').forEach((b) => b.addEventListener('click', () => setMode(b.dataset.mode)));
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

  try { renderState(await api('GET', '/api/state')); } catch { /* ignore */ }
}

init();
