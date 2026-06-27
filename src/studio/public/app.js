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
  if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`);
  return data;
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]));
}

function setStep(stepId, html) {
  const panel = $(stepId);
  panel.classList.add('active');
  panel.querySelector('.text').innerHTML = html;
}

function decisionButtons(enabled) {
  document.querySelectorAll('[data-decision]').forEach((button) => { button.disabled = !enabled; });
}

// --- Setup / mode / key --------------------------------------------------

function setMode(mode) {
  currentMode = mode === 'image' ? 'image' : 'mock';
  document.querySelectorAll('#mode-toggle button').forEach((b) => b.classList.toggle('active', b.dataset.mode === currentMode));
  $('image-setup').classList.toggle('hidden', currentMode !== 'image');
  const banner = $('mode-banner');
  if (currentMode === 'image') { banner.textContent = 'IMAGE MODE'; banner.className = 'mode-image'; }
  else { banner.textContent = 'MOCK MODE'; banner.className = 'mode-mock'; }
}

function setKeyStatus(present) {
  const el = $('key-status');
  el.textContent = present ? 'key: set ✓' : 'key: not set';
  el.className = present ? 'ok' : 'muted';
}

async function setKey() {
  const key = $('image-key').value.trim();
  if (!key) { $('test-result').textContent = 'Enter a key first.'; $('test-result').className = 'bad'; return; }
  try {
    const r = await api('POST', '/api/image/key', { key });
    setKeyStatus(r.image_key_present);
    $('image-key').value = ''; // do not keep the key in the DOM
    $('test-result').textContent = '';
  } catch (e) { $('test-result').textContent = e.message; $('test-result').className = 'bad'; }
}

async function clearKey() {
  try { const r = await api('POST', '/api/image/key/clear'); setKeyStatus(r.image_key_present); } catch { /* ignore */ }
  $('test-result').textContent = '';
}

async function testConnection() {
  $('test-result').textContent = 'testing…';
  $('test-result').className = 'muted';
  try {
    const r = await api('POST', '/api/image/test');
    if (r.ok) { $('test-result').textContent = 'connection ok ✓'; $('test-result').className = 'ok'; }
    else { $('test-result').textContent = r.error || 'failed'; $('test-result').className = 'bad'; }
  } catch (e) { $('test-result').textContent = e.message; $('test-result').className = 'bad'; }
}

// --- Cycle ---------------------------------------------------------------

function renderReflection(reflection) {
  if (!reflection) return '<span class="muted">No reflection.</span>';
  const lines = [];
  if (reflection.truth_read) lines.push(`Truth: ${escapeHtml(reflection.truth_read)}`);
  if (reflection.strongest_objection) lines.push(`Strongest objection: ${escapeHtml(reflection.strongest_objection)}`);
  if (reflection.revision) lines.push(`Revision impulse: ${escapeHtml(reflection.revision)}`);
  if (reflection.audit?.recommended_action) lines.push(`Audit: ${escapeHtml(reflection.audit.recommended_action)}`);
  return lines.join('\n') || '<span class="muted">No reflection.</span>';
}

function renderState(state) {
  const canon = state.canon ?? [];
  const active = canon.filter((work) => !work.revoked);
  const revoked = canon.filter((work) => work.revoked);
  const motifs = Object.keys(state.motifs ?? {});
  const html = [];
  html.push(`<p class="text"><strong>${active.length}</strong> active canon · <strong>${revoked.length}</strong> revoked · <strong>${state.cycle_count ?? 0}</strong> cycles</p>`);
  if (canon.length) {
    html.push('<div>' + canon.map((work) => {
      const cls = work.revoked ? 'canon-item revoked' : 'canon-item';
      const tail = work.revoked ? ` — revoked (${escapeHtml(work.revocation?.revoked_by ?? 'unknown')})` : (work.human_decision ? ` — ${escapeHtml(work.human_decision)}` : '');
      return `<div class="${cls}">${escapeHtml(work.title ?? work.cycle_id)}${tail}</div>`;
    }).join('') + '</div>');
  }
  if (motifs.length) html.push('<p class="text muted">Motifs: ' + motifs.map((m) => `<span class="pill">${escapeHtml(m)} ·${state.motifs[m]}</span>`).join('') + '</p>');
  if ((state.unresolved_tensions ?? []).length) html.push('<p class="text muted">Tensions: ' + state.unresolved_tensions.map((t) => escapeHtml(t)).join('; ') + '</p>');
  $('state').innerHTML = html.join('');
}

async function refreshState() {
  try { renderState(await api('GET', '/api/state')); } catch { /* ignore */ }
}

function showError(message) {
  let text = message;
  if (/Maximum cycle budget reached/i.test(message)) text += ' — run `npm run reset` in the terminal to archive this studio and start fresh.';
  $('error').textContent = text;
}

async function beginCycle() {
  $('error').textContent = '';
  const seed = $('seed').value.trim();
  if (!seed) { showError('Enter a seed idea first.'); return; }
  $('begin').disabled = true;
  $('begin').textContent = 'Working…';
  decisionButtons(false);
  $('decision-result').textContent = '';
  const body = { seed, mode: currentMode };
  if (currentMode === 'image') {
    if ($('image-model').value.trim()) body.model = $('image-model').value.trim();
    if ($('image-size').value.trim()) body.size = $('image-size').value.trim();
  }
  try {
    const cycle = await api('POST', '/api/cycle', body);
    currentCycleId = cycle.cycle_id;
    setStep('step-brief', escapeHtml(cycle.artist_brief) || '<span class="muted">The curator refused this seed.</span>');
    setStep('step-prompt', escapeHtml(cycle.generated_prompt) || '<span class="muted">No prompt.</span>');
    if (cycle.artifact_url) {
      setStep('step-artifact', `<img class="artifact" src="${cycle.artifact_url}" alt="generated artifact" />` +
        `<p class="text muted">Provider: ${escapeHtml(cycle.mode)} · saved at ${escapeHtml(cycle.metadata.artifact_path)}</p>`);
    } else {
      setStep('step-artifact', '<span class="muted">No artifact (curator did not accept a candidate).</span>');
    }
    setStep('step-reflection', renderReflection(cycle.reflection));
    $('step-decision').classList.add('active');
    decisionButtons(Boolean(cycle.artifact_url));
    renderState(cycle.state);
  } catch (error) {
    showError(error.message);
  } finally {
    $('begin').disabled = false;
    $('begin').textContent = 'Begin Cycle';
  }
}

async function decide(decision) {
  if (!currentCycleId) return;
  decisionButtons(false);
  try {
    const result = await api('POST', `/api/cycle/${currentCycleId}/decision`, { decision });
    $('decision-result').textContent = `Recorded: ${decision}.`;
    renderState(result.state);
  } catch (error) {
    $('decision-result').textContent = error.message;
    decisionButtons(true);
  }
}

async function init() {
  let config = { mode: 'mock', image_key_present: false, model: 'gpt-image-1', size: '1024x1024' };
  try { config = await api('GET', '/api/config'); } catch { /* keep defaults */ }
  setMode(config.mode);
  setKeyStatus(config.image_key_present);
  if (config.model) $('image-model').value = config.model;
  if (config.size) $('image-size').value = config.size;

  document.querySelectorAll('#mode-toggle button').forEach((b) => b.addEventListener('click', () => setMode(b.dataset.mode)));
  $('set-key').addEventListener('click', setKey);
  $('clear-key').addEventListener('click', clearKey);
  $('test-conn').addEventListener('click', testConnection);
  $('begin').addEventListener('click', beginCycle);
  document.querySelectorAll('[data-decision]').forEach((button) =>
    button.addEventListener('click', () => decide(button.dataset.decision)));
  await refreshState();
}

init();
