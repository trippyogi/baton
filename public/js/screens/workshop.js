import { get, post, patch, humanTime } from '../api.js';

const TYPES    = ['all', 'tool', 'feature', 'app', 'skill'];
const STATUSES = ['shipped', 'wip', 'broken'];

let activeType    = 'all';
let expandedId    = null;
let cachedBuilds  = [];

// ── Main render ───────────────────────────────────────

export async function renderWorkshop() {
  const el = document.getElementById('screen-workshop');
  el.innerHTML = `<div class="loading">Loading workshop…</div>`;

  try {
    cachedBuilds = await get('/api/builds');
    activeType   = 'all';
    expandedId   = null;
    paint(el, cachedBuilds);
  } catch (err) {
    el.innerHTML = `<div class="loading" style="color:var(--color-red)">Error: ${err.message}</div>`;
  }
}

// ── Paint (filter-aware re-render) ────────────────────

function paint(el, builds) {
  const filtered = activeType === 'all'
    ? builds
    : builds.filter(b => b.type === activeType);

  el.innerHTML = `
<div class="canvas-inner">

  <!-- Header -->
  <div class="screen-header" style="display:flex;justify-content:space-between;align-items:flex-start;padding-top:8px;margin-bottom:24px">
    <div>
      <div class="screen-title" style="font-size:28px;font-weight:600;letter-spacing:-0.02em">Workshop</div>
      <div class="screen-subtitle" style="margin-top:8px">Nightly builds — shipped tools, features and experiments</div>
    </div>
    <button class="btn btn-primary" id="btn-log-build">+ Log Build</button>
  </div>

  <!-- Filter bar -->
  <div style="display:flex;gap:8px;margin-bottom:24px;flex-wrap:wrap">
    ${TYPES.map(t => `
      <button
        class="btn btn-ghost btn-sm workshop-filter${activeType === t ? ' filter-active' : ''}"
        data-type="${t}"
        style="${activeType === t ? 'border-color:var(--color-teal);color:var(--color-teal)' : ''}"
      >${t === 'all' ? 'All' : cap(t)}</button>`).join('')}
    <span style="margin-left:auto;font-size:12px;color:var(--text-secondary);align-self:center">${filtered.length} build${filtered.length !== 1 ? 's' : ''}</span>
  </div>

  <!-- Build grid -->
  ${filtered.length === 0
    ? `<div class="empty-state" style="margin-top:64px">
        <span class="empty-state-icon">⚗</span>
        No builds yet — first nightly build ships tomorrow morning
       </div>`
    : `<div class="workshop-grid">${filtered.map(b => buildCard(b)).join('')}</div>`}

</div>`;

  // Wire filter buttons
  el.querySelectorAll('.workshop-filter').forEach(btn => {
    btn.onclick = () => {
      activeType = btn.dataset.type;
      paint(el, cachedBuilds);
    };
  });

  // Wire card expand toggles
  el.querySelectorAll('.build-card').forEach(card => {
    card.addEventListener('click', (e) => {
      // Don't expand if clicking a button inside the card
      if (e.target.closest('button')) return;
      const id = card.dataset.id;
      expandedId = expandedId === id ? null : id;
      paint(el, cachedBuilds);
    });
  });

  // Wire Log Build button
  document.getElementById('btn-log-build').onclick = () => showBuildModal(el);

  // Wire edit/status buttons
  el.querySelectorAll('.build-status-btn').forEach(btn => {
    btn.onclick = async (e) => {
      e.stopPropagation();
      const id     = btn.dataset.id;
      const status = btn.dataset.status;
      await patch(`/api/builds/${id}`, { status });
      cachedBuilds = await get('/api/builds');
      paint(el, cachedBuilds);
    };
  });
}

// ── Build card HTML ───────────────────────────────────

function buildCard(b) {
  const isExpanded = expandedId === b.id;
  const tags = (b.tags || []).map(t =>
    `<span class="badge badge-medium" style="font-size:10px">${t}</span>`
  ).join(' ');

  return `
<div class="card build-card${isExpanded ? ' build-card-expanded' : ''}" data-id="${b.id}" style="cursor:pointer">
  <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin-bottom:10px">
    <div style="flex:1;min-width:0">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
        <span class="badge badge-type-${b.type}">${b.type}</span>
        <span class="badge badge-status-${b.status}">${b.status}</span>
      </div>
      <div style="font-size:15px;font-weight:600;color:var(--text-primary);margin-bottom:4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${b.name}</div>
      <div style="font-size:13px;color:var(--text-secondary);line-height:1.4">${b.description}</div>
    </div>
    <div style="text-align:right;flex-shrink:0">
      <div style="font-size:11px;color:var(--text-secondary)">${b.nightly_date || '—'}</div>
      <div style="font-size:11px;color:var(--text-secondary);margin-top:2px">${b.built_by}</div>
    </div>
  </div>

  ${tags ? `<div style="display:flex;gap:4px;flex-wrap:wrap;margin-bottom:10px">${tags}</div>` : ''}

  <div style="font-family:var(--font-instrument);font-size:11px;color:var(--color-teal);opacity:0.8;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${b.path || '—'}</div>

  <!-- Expanded notes section -->
  ${isExpanded && b.notes ? `
  <div style="margin-top:14px;padding-top:14px;border-top:1px solid var(--border)">
    <div style="font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:0.1em;color:var(--text-secondary);margin-bottom:8px">Notes</div>
    <div style="font-size:13px;color:var(--text-primary);line-height:1.6;white-space:pre-wrap">${b.notes}</div>
  </div>` : ''}

  ${isExpanded ? `
  <div style="margin-top:14px;padding-top:14px;border-top:1px solid var(--border);display:flex;gap:6px">
    <span style="font-size:11px;color:var(--text-secondary);align-self:center;margin-right:4px">Mark as:</span>
    ${STATUSES.filter(s => s !== b.status).map(s => `
      <button class="btn btn-ghost btn-sm build-status-btn" data-id="${b.id}" data-status="${s}" style="font-size:11px">${s}</button>
    `).join('')}
    <span style="font-size:11px;color:var(--text-secondary);margin-left:auto;align-self:center">${humanTime(b.created_at)}</span>
  </div>` : ''}
</div>`;
}

// ── Create modal ──────────────────────────────────────

function showBuildModal(screenEl) {
  const modal = document.createElement('div');
  modal.className = 'modal-backdrop';
  modal.innerHTML = `
    <div class="modal" onclick="event.stopPropagation()" style="width:560px">
      <div class="modal-title">Log Build</div>

      <div class="form-field">
        <label class="form-label">Name *</label>
        <input class="form-input" id="bld-name" placeholder="e.g. Meta Analytics Cron">
      </div>
      <div class="form-field">
        <label class="form-label">Description</label>
        <textarea class="form-textarea" id="bld-desc" placeholder="What does it do?"></textarea>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
        <div class="form-field">
          <label class="form-label">Type</label>
          <select class="form-select" id="bld-type">
            ${['tool','feature','app','skill'].map(t =>
              `<option value="${t}">${cap(t)}</option>`).join('')}
          </select>
        </div>
        <div class="form-field">
          <label class="form-label">Status</label>
          <select class="form-select" id="bld-status">
            ${STATUSES.map(s =>
              `<option value="${s}">${s}</option>`).join('')}
          </select>
        </div>
      </div>
      <div class="form-field">
        <label class="form-label">Path</label>
        <input class="form-input" id="bld-path" placeholder="/home/ubuntu/clawd/...">
      </div>
      <div class="form-field">
        <label class="form-label">Tags (comma-separated)</label>
        <input class="form-input" id="bld-tags" placeholder="node, meta, cron">
      </div>
      <div class="form-field">
        <label class="form-label">Notes</label>
        <textarea class="form-textarea" id="bld-notes" placeholder="Implementation notes, caveats, next steps…" style="min-height:100px"></textarea>
      </div>

      <div class="modal-actions">
        <button class="btn btn-ghost" id="bld-cancel">Cancel</button>
        <button class="btn btn-primary" id="bld-save">Log Build</button>
      </div>
    </div>`;

  document.body.appendChild(modal);
  modal.onclick = () => modal.remove();
  document.getElementById('bld-cancel').onclick = () => modal.remove();

  document.getElementById('bld-save').onclick = async () => {
    const name = document.getElementById('bld-name').value.trim();
    if (!name) { alert('Name is required'); return; }

    const tagsRaw = document.getElementById('bld-tags').value;
    const tags    = tagsRaw.split(',').map(t => t.trim()).filter(Boolean);
    const today   = new Date().toISOString().slice(0, 10);

    const body = {
      name,
      description:  document.getElementById('bld-desc').value.trim(),
      type:         document.getElementById('bld-type').value,
      status:       document.getElementById('bld-status').value,
      path:         document.getElementById('bld-path').value.trim(),
      tags,
      notes:        document.getElementById('bld-notes').value.trim(),
      nightly_date: today,
      built_by:     'vector+circuit',
    };

    try {
      await post('/api/builds', body);
      modal.remove();
      cachedBuilds = await get('/api/builds');
      paint(screenEl, cachedBuilds);
    } catch(e) { alert('Error: ' + e.message); }
  };

  // Focus name field
  setTimeout(() => document.getElementById('bld-name')?.focus(), 50);
}

// ── Utilities ─────────────────────────────────────────

function cap(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
