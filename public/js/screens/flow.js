import { get, post, patch } from '../api.js';
import { escapeHtml, escapeAttr } from '../lib/html.js';

const MODES = ['deep_build','triage','review','strategy_creative','launch','admin','cleanup','recovery'];
let pollTimer = null;
let selectedIndex = 0;
let currentData = null;

export async function renderFlow(options = {}) {
  const force = options.force === true;
  const el = document.getElementById('screen-flow');
  if (!el) return;
  if (!force && document.activeElement?.id === 'flow-command-input') return;
  el.innerHTML = `<div class="loading">Loading Flow…</div>`;
  try {
    currentData = await get('/api/flow');
    selectedIndex = Math.min(selectedIndex, Math.max((currentData.next_touches || []).length - 1, 0));
    el.innerHTML = flowMarkup(currentData);
    wireFlow(el);
    resetPoll();
  } catch (err) {
    el.innerHTML = `<div class="loading" style="color:var(--color-red)">Error: ${escapeHtml(err.message)}</div>`;
  }
}

export function destroyFlow() {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = null;
  document.removeEventListener('keydown', handleKeys);
}

function resetPoll() {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = setInterval(() => {
    if (document.activeElement?.id !== 'flow-command-input') renderFlow();
  }, 30000);
  document.removeEventListener('keydown', handleKeys);
  document.addEventListener('keydown', handleKeys);
}

function flowMarkup(data) {
  return `
    <div class="flow-shell">
      <section class="flow-header">
        <div>
          <div class="screen-title">Flow</div>
          <div class="screen-subtitle">Keep the swarm moving. Touch only what matters.</div>
        </div>
        <div class="flow-mode">
          <label for="flow-mode-select">Mode</label>
          <select id="flow-mode-select" class="mode-select">
            ${MODES.map(mode => `<option value="${mode}"${mode === data.mode ? ' selected' : ''}>${labelMode(mode)}</option>`).join('')}
          </select>
        </div>
      </section>

      <section class="flow-airspace card">
        <div class="flow-airspace-title">Airspace</div>
        <div class="flow-airspace-grid">
          ${airspaceItem('Airborne', data.airspace.running)}
          ${airspaceItem('Need touch', data.airspace.needs_touch)}
          ${airspaceItem('Review', data.airspace.review)}
          ${airspaceItem('Idle', data.airspace.idle)}
          ${airspaceItem('Stale', data.airspace.stale)}
          ${airspaceItem('Failed', data.airspace.failed)}
          ${airspaceItem('Ready', data.airspace.ready_to_pass)}
          ${airspaceItem('Inbox', data.airspace.inbox)}
        </div>
      </section>

      <section class="flow-command card">
        <textarea id="flow-command-input" class="flow-command-input" rows="2" placeholder="Capture, delegate, review, decide, or ask BATON..."></textarea>
        <div class="flow-command-actions">
          <span class="flow-hint">Try: capture idea · delegate task · review next · mode launch</span>
          <button id="flow-command-submit" class="btn btn-primary">Pass</button>
        </div>
        <div id="flow-command-result" class="flow-command-result"></div>
      </section>

      <section class="flow-next">
        <div class="flow-section-title">
          <span>Next Touches</span>
          <a href="#/board" class="flow-board-link">Airspace map →</a>
        </div>
        <div id="flow-touch-list">
          ${(data.next_touches || []).length ? data.next_touches.map((touch, idx) => touchCard(touch, idx)).join('') : emptyState()}
        </div>
      </section>
    </div>`;
}

function airspaceItem(label, value) {
  return `<div class="flow-airspace-item"><div class="flow-airspace-value">${value ?? 0}</div><div class="flow-airspace-label">${label}</div></div>`;
}

function touchCard(touch, idx) {
  const active = idx === selectedIndex ? ' touch-card-active' : '';
  return `
    <article class="touch-card${active}" data-touch-id="${escapeAttr(touch.id)}" data-index="${escapeAttr(idx)}">
      <div class="touch-rank">#${touch.rank || idx + 1}</div>
      <div class="touch-body">
        <div class="touch-title">${escapeHtml(touch.title)}</div>
        <div class="touch-meta">
          <span class="badge badge-${escapeAttr(touch.type)}">${escapeHtml(touch.type)}</span>
          <span>${escapeHtml(touch.domain || 'product')}</span>
          <span>~${touch.human_touch_minutes || 5}m</span>
          <span>${escapeHtml(touch.risk_level || 'low')} risk</span>
          <span>L${touch.autonomy_level || 1}</span>
        </div>
        <div class="touch-why">${escapeHtml(touch.why_now || 'Ranks well for current mode.')}</div>
        <div class="touch-detail" hidden>
          <div><strong>Summary</strong><br>${escapeHtml(touch.description || 'No extra context yet.')}</div>
          <textarea class="touch-feedback" rows="3" placeholder="Feedback, answer, refinement, or delegation instructions..."></textarea>
          <div class="touch-detail-actions">
            <button class="btn btn-primary touch-submit-feedback">Send feedback</button>
            ${allows(touch, 'accept') ? '<button class="btn btn-ghost touch-accept">Accept</button>' : ''}
            ${allows(touch, 'archive') ? '<button class="btn btn-ghost touch-archive">Archive</button>' : ''}
          </div>
        </div>
      </div>
      <div class="touch-actions">
        <button class="btn btn-primary touch-primary">${primaryLabel(touch)}</button>
        ${allows(touch, 'snooze') ? '<button class="btn btn-ghost touch-snooze">Snooze</button>' : ''}
      </div>
    </article>`;
}

function emptyState() {
  return `<div class="card flow-empty">No touches need Jeremy right now. Capture an idea or delegate ready work to seed the queue.</div>`;
}

function wireFlow(el) {
  const modeSelect = el.querySelector('#flow-mode-select');
  modeSelect.onchange = async () => {
    await patch('/api/flow/mode', { mode: modeSelect.value });
    await renderFlow({ force: true });
  };

  const input = el.querySelector('#flow-command-input');
  input.addEventListener('input', () => {
    input.style.height = 'auto';
    input.style.height = `${Math.min(input.scrollHeight, 180)}px`;
  });
  input.addEventListener('keydown', async (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') await submitCommand(el);
  });
  el.querySelector('#flow-command-submit').onclick = () => submitCommand(el);

  el.querySelectorAll('.touch-card').forEach(card => {
    card.onclick = (event) => {
      if (event.target.closest('button') || event.target.closest('textarea')) return;
      selectedIndex = Number(card.dataset.index || 0);
      openSelected();
    };
    card.querySelector('.touch-primary').onclick = () => primaryAction(card.dataset.touchId);
    card.querySelector('.touch-snooze')?.addEventListener('click', () => runAction(card.dataset.touchId, 'snooze'));
    card.querySelector('.touch-accept')?.addEventListener('click', () => runAction(card.dataset.touchId, 'accept'));
    card.querySelector('.touch-archive')?.addEventListener('click', () => runAction(card.dataset.touchId, 'archive'));
    card.querySelector('.touch-submit-feedback').onclick = () => {
      const touch = currentData.next_touches[Number(card.dataset.index || 0)];
      const feedback = card.querySelector('.touch-feedback').value;
      const action = ['delegate', 'assign', 'answer', 'process', 'send_to_evaluator'].includes(touch.primary_action) ? touch.primary_action : 'refine';
      runAction(card.dataset.touchId, action, { feedback, instructions: feedback });
    };
  });
}

async function submitCommand(el) {
  const input = el.querySelector('#flow-command-input');
  const resultEl = el.querySelector('#flow-command-result');
  const value = input.value.trim();
  if (!value) return;
  resultEl.textContent = 'Passing…';
  const result = await post('/api/flow/command', { input: value });
  input.value = '';
  resultEl.textContent = result.message || 'Done.';
  await renderFlow({ force: true });
}

function primaryAction(id) {
  const touch = (currentData.next_touches || []).find(t => t.id === id);
  if (!touch) return;
  if (touch.type === 'review' || ['refine', 'delegate', 'assign', 'answer', 'decide', 'send_to_evaluator'].includes(touch.primary_action)) {
    const card = document.querySelector(`.touch-card[data-touch-id="${id}"]`);
    const detail = card?.querySelector('.touch-detail');
    if (detail) detail.hidden = !detail.hidden;
    return;
  }
  return runAction(id, touch.primary_action || 'inspect');
}

async function runAction(id, action, extra = {}) {
  const touch = (currentData?.next_touches || []).find(t => t.id === id);
  if (touch && !allows(touch, action)) return;
  await patch(`/api/touches/${id}/action`, { action, ...extra });
  await renderFlow({ force: true });
}

function handleKeys(event) {
  const tag = document.activeElement?.tagName?.toLowerCase();
  if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
  const touches = currentData?.next_touches || [];
  if (event.key === '/') {
    event.preventDefault();
    document.getElementById('flow-command-input')?.focus();
  } else if (event.key === 'j') {
    selectedIndex = Math.min(selectedIndex + 1, touches.length - 1);
    refreshSelection();
  } else if (event.key === 'k') {
    selectedIndex = Math.max(selectedIndex - 1, 0);
    refreshSelection();
  } else if (event.key === 'Enter') {
    openSelected();
  } else if (event.key === 's') {
    if (touches[selectedIndex]) runAction(touches[selectedIndex].id, 'snooze');
  } else if (event.key === 'x') {
    if (touches[selectedIndex]) runAction(touches[selectedIndex].id, 'archive');
  } else if (event.key === 'a') {
    if (touches[selectedIndex] && allows(touches[selectedIndex], 'accept')) runAction(touches[selectedIndex].id, 'accept');
  } else if (event.key === 'd') {
    const touch = touches[selectedIndex];
    if (touch && allows(touch, 'assign')) runAction(touch.id, 'assign');
    else if (touch && allows(touch, 'delegate')) runAction(touch.id, 'delegate');
  } else if (event.key === 'r') {
    openSelected();
  } else if (event.key === 'm') {
    document.getElementById('flow-mode-select')?.focus();
  }
}

function refreshSelection() {
  document.querySelectorAll('.touch-card').forEach((card, idx) => {
    card.classList.toggle('touch-card-active', idx === selectedIndex);
  });
}

function openSelected() {
  refreshSelection();
  const card = document.querySelector(`.touch-card[data-index="${selectedIndex}"]`);
  const detail = card?.querySelector('.touch-detail');
  if (detail) detail.hidden = !detail.hidden;
}

function labelMode(mode) {
  return mode.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function labelAction(action) {
  return String(action || 'open').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function primaryLabel(touch) {
  if (touch.type === 'review' && touch.primary_action === 'inspect') return 'Review';
  if (['delegate', 'assign'].includes(touch.primary_action)) return 'Prepare';
  return labelAction(touch.primary_action);
}

function actionsFor(touch) {
  return new Set([touch?.primary_action, ...(touch?.secondary_actions || [])].filter(Boolean));
}

function allows(touch, action) {
  return actionsFor(touch).has(action);
}
