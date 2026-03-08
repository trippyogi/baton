import { get, patch, createSSE, timeAgo, fmtCost, fmtTokens } from '../api.js';

let sseConn     = null;
let activeFilter = { worker_type: '', status: '' };

const WORKER_COLORS = {
  'analytics-worker':      '#00E5CC',
  'content-worker':        '#7B2FBE',
  'seo-worker':            '#fbbf24',
  'research-worker':       '#60a5fa',
  'cro-worker':            '#f87171',
  'data-ingestion-worker': '#a78bfa',
};

function workerBadge(workerType) {
  if (!workerType) return '<span style="color:var(--text-secondary);font-size:11px">—</span>';
  const color = WORKER_COLORS[workerType] || '#9898AC';
  const label = workerType.replace('-worker', '');
  return `<span style="font-size:10px;font-weight:600;letter-spacing:.04em;padding:2px 7px;border-radius:999px;background:${color}18;color:${color};border:1px solid ${color}40">${label}</span>`;
}

export async function renderRuns() {
  const el = document.getElementById('screen-runs');
  el.innerHTML = `<div class="loading">Loading runs…</div>`;
  try {
    const params = new URLSearchParams({ limit: 50 });
    if (activeFilter.worker_type) params.set('worker_type', activeFilter.worker_type);
    if (activeFilter.status)      params.set('status',      activeFilter.status);

    const { runs, total } = await get(`/api/runs?${params}`);

    el.innerHTML = `
      <div class="screen-header" style="display:flex;justify-content:space-between;align-items:flex-start">
        <div>
          <div class="screen-title">Runs</div>
          <div class="screen-subtitle">${total} total runs</div>
        </div>
        <span style="font-size:11px;color:var(--color-lime);display:flex;align-items:center;gap:4px">
          <span class="status-dot healthy live-dot"></span> Live
        </span>
      </div>

      <div class="card" style="margin-bottom:var(--gap);display:flex;gap:12px;align-items:center;flex-wrap:wrap;padding:12px 16px">
        <span style="font-size:12px;color:var(--text-secondary);font-weight:500">Filter:</span>
        <select id="filter-worker" style="font-size:12px;padding:4px 8px;border-radius:6px;border:1px solid var(--border);background:var(--bg-surface);color:var(--text-primary);cursor:pointer">
          <option value="">All workers</option>
          ${Object.keys(WORKER_COLORS).map(w => `<option value="${w}" ${activeFilter.worker_type === w ? 'selected' : ''}>${w.replace('-worker','')}</option>`).join('')}
        </select>
        <select id="filter-status" style="font-size:12px;padding:4px 8px;border-radius:6px;border:1px solid var(--border);background:var(--bg-surface);color:var(--text-primary);cursor:pointer">
          <option value="">All statuses</option>
          ${['running','completed','failed','pending'].map(s => `<option value="${s}" ${activeFilter.status === s ? 'selected' : ''}>${s}</option>`).join('')}
        </select>
        <button class="btn btn-ghost btn-sm" id="filter-clear" style="font-size:11px">Clear</button>
      </div>

      <div class="card" style="margin-bottom:var(--gap)">
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Agent</th>
                <th>Worker</th>
                <th>Status</th>
                <th>Tokens</th>
                <th>Cost</th>
                <th>Started</th>
                <th>Duration</th>
                <th></th>
              </tr>
            </thead>
            <tbody id="runs-tbody">
              ${runs.map(r => runRow(r)).join('')}
            </tbody>
          </table>
        </div>
      </div>
      <div id="run-detail"></div>`;

    // Filter controls
    el.querySelector('#filter-worker').onchange = e => {
      activeFilter.worker_type = e.target.value;
      renderRuns();
    };
    el.querySelector('#filter-status').onchange = e => {
      activeFilter.status = e.target.value;
      renderRuns();
    };
    el.querySelector('#filter-clear').onclick = () => {
      activeFilter = { worker_type: '', status: '' };
      renderRuns();
    };

    // SSE live updates
    if (sseConn) sseConn.close();
    sseConn = createSSE('/api/runs/stream', {
      run_updated: (run) => updateRunRow(run),
      snapshot:    () => {},
    });

    el.querySelectorAll('.run-expand').forEach(btn => {
      btn.onclick = () => showRunDetail(btn.dataset.id, runs);
    });

  } catch(err) {
    el.innerHTML = `<div class="loading" style="color:var(--color-red)">Error: ${err.message}</div>`;
  }
}

function runRow(r) {
  const duration = r.started_at && r.ended_at
    ? `${Math.round((new Date(r.ended_at) - new Date(r.started_at)) / 1000)}s`
    : r.status === 'running' ? '⏱ running' : '—';
  return `<tr data-run-id="${r.id}">
    <td>${r.agent_name}</td>
    <td>${workerBadge(r.worker_type)}</td>
    <td><span class="badge badge-${r.status}">${r.status}</span></td>
    <td style="font-family:var(--font-instrument)">${fmtTokens(r.tokens)}</td>
    <td style="font-family:var(--font-instrument)">${fmtCost(r.cost)}</td>
    <td style="font-size:12px;color:var(--text-secondary)">${timeAgo(r.started_at)}</td>
    <td style="font-family:var(--font-instrument);font-size:12px">${duration}</td>
    <td><button class="btn btn-ghost btn-sm run-expand" data-id="${r.id}">Detail</button></td>
  </tr>`;
}

function updateRunRow(run) {
  const row = document.querySelector(`tr[data-run-id="${run.id}"]`);
  if (!row) return;
  const tmp = document.createElement('tbody');
  tmp.innerHTML = runRow(run);
  const newRow = tmp.firstElementChild;
  row.replaceWith(newRow);
  newRow.querySelector('.run-expand').onclick = () => showRunDetail(run.id, [run]);
}

async function showRunDetail(id, cached) {
  const detailEl = document.getElementById('run-detail');
  let run = cached.find(r => r.id === id);
  if (!run) {
    try { run = await get(`/api/runs/${id}`); } catch { return; }
  }
  const logs  = run.logs  || [];
  const steps = run.steps || [];

  detailEl.innerHTML = `
    <div class="card">
      <div class="card-header">
        <span class="card-title">Run Detail — ${run.agent_name}${run.worker_type ? ` · ${workerBadge(run.worker_type)}` : ''}</span>
        <button class="btn btn-ghost btn-sm" id="close-detail">Close</button>
      </div>
      <div style="display:grid;grid-template-columns:repeat(5,1fr);gap:12px;margin-bottom:16px">
        <div><div class="kpi-label">Status</div><span class="badge badge-${run.status}">${run.status}</span></div>
        <div><div class="kpi-label">Worker</div>${workerBadge(run.worker_type)}</div>
        <div><div class="kpi-label">Tokens</div><div style="font-family:var(--font-instrument)">${fmtTokens(run.tokens)}</div></div>
        <div><div class="kpi-label">Cost</div><div style="font-family:var(--font-instrument);color:var(--accent)">${fmtCost(run.cost)}</div></div>
        <div><div class="kpi-label">Started</div><div style="font-size:12px;color:var(--text-secondary)">${run.started_at || '—'}</div></div>
      </div>
      ${run.output_path ? `
        <div class="kpi-label" style="margin-bottom:6px">Output</div>
        <div style="font-size:11px;font-family:monospace;background:var(--bg-base);border-radius:var(--radius-sm);padding:8px 12px;color:var(--color-ash);margin-bottom:12px">${run.output_path}</div>` : ''}
      ${steps.length > 0 ? `
        <div class="kpi-label" style="margin-bottom:8px">Steps</div>
        <div style="font-size:12px;font-family:var(--font-instrument);background:var(--bg-surface);border-radius:var(--radius-sm);padding:12px;max-height:200px;overflow-y:auto">
          ${steps.map(s => `<div style="padding:2px 0;border-bottom:1px solid var(--border)">${JSON.stringify(s)}</div>`).join('')}
        </div>` : ''}
      ${logs.length > 0 ? `
        <div class="kpi-label" style="margin:12px 0 8px">Logs</div>
        <div style="font-size:11px;font-family:monospace;background:var(--bg-base);border-radius:var(--radius-sm);padding:12px;max-height:160px;overflow-y:auto;color:var(--color-ash)">
          ${logs.map(l => `<div>${typeof l === 'string' ? l : JSON.stringify(l)}</div>`).join('')}
        </div>` : ''}
      ${steps.length === 0 && logs.length === 0 ? '<div class="empty-state">No step detail available</div>' : ''}
    </div>`;
  document.getElementById('close-detail').onclick = () => detailEl.innerHTML = '';
}
