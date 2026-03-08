import { get, timeAgo, fmtCost } from '../api.js';

let _pollTimer = null;

function statusDot(lag) {
  const color = lag === 0 ? 'var(--color-lime)' : lag < 10 ? '#fbbf24' : 'var(--color-red)';
  return `<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${color};margin-right:6px"></span>`;
}

function statusBadge(status) {
  const map = {
    success:   { bg: 'var(--color-lime)',   text: '#0a1a0a' },
    failed:    { bg: 'var(--color-red)',    text: '#fff'    },
    escalated: { bg: '#fbbf24',             text: '#1a1200' },
    running:   { bg: 'var(--color-teal)',   text: '#001a18' },
    pending:   { bg: '#9898AC',             text: '#fff'    },
  };
  const s = map[status] || { bg: '#9898AC', text: '#fff' };
  return `<span style="font-size:10px;font-weight:600;padding:2px 8px;border-radius:999px;background:${s.bg};color:${s.text}">${status}</span>`;
}

export async function renderQueue() {
  const el = document.getElementById('screen-queue');
  el.innerHTML = `<div class="loading">Loading queue…</div>`;

  try {
    const [stats, streams, streamStatus, { runs }] = await Promise.all([
      get('/api/queue/stats'),
      get('/api/queue'),
      get('/api/queue/stream-status'),
      get('/api/runs?limit=10'),
    ]);

    el.innerHTML = `
      <div class="screen-header">
        <div class="screen-title">Queue</div>
        <div class="screen-subtitle">Agent mesh stream health &amp; recent activity</div>
      </div>

      <!-- KPI Strip -->
      <div class="kpi-strip" style="margin-bottom:var(--gap)">
        ${kpi('Jobs Today',     stats.jobs_today)}
        ${kpi('Success Rate',   stats.success_rate_pct + '%')}
        ${kpi('Avg Duration',   stats.avg_duration_sec + 's')}
        ${kpi('Avg Cost',       fmtCost(stats.avg_cost_usd))}
        ${kpi('Fix Loop Avg',   stats.fix_loop_avg + ' attempts')}
      </div>

      <!-- Stream Health -->
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:var(--gap);margin-bottom:var(--gap)">
        ${streams.streams.map(s => streamCard(s)).join('')}
      </div>

      <!-- Pending Jobs -->
      <div class="card" style="margin-bottom:var(--gap)">
        <div class="card-header">
          <span class="card-title">Pending Jobs</span>
        </div>
        ${pendingTable(streamStatus)}
      </div>

      <!-- Recent Runs -->
      <div class="card">
        <div class="card-header">
          <span class="card-title">Recent Runs</span>
          <a href="#/runs" style="font-size:11px;color:var(--accent);text-decoration:none">View all →</a>
        </div>
        ${recentRunsTable(runs)}
      </div>`;

    // Poll every 15s
    if (_pollTimer) clearInterval(_pollTimer);
    _pollTimer = setInterval(() => renderQueue(), 15_000);

  } catch (err) {
    el.innerHTML = `<div class="loading" style="color:var(--color-red)">Error: ${err.message}</div>`;
  }
}

export function destroyQueue() {
  if (_pollTimer) { clearInterval(_pollTimer); _pollTimer = null; }
}

function kpi(label, value) {
  return `
    <div class="kpi-card">
      <div class="kpi-label">${label}</div>
      <div class="kpi-value">${value}</div>
    </div>`;
}

function streamCard(stream) {
  const groups = stream.groups || [];
  const totalLag = groups.reduce((a, g) => a + (g.lag || 0), 0);
  return `
    <div class="card">
      <div class="card-header" style="margin-bottom:12px">
        <span class="card-title" style="font-family:monospace;font-size:13px">${stream.name}</span>
        <span style="font-size:11px;color:var(--text-secondary)">${stream.length} msgs</span>
      </div>
      ${groups.length === 0
        ? `<div style="font-size:12px;color:var(--text-secondary)">No consumer groups</div>`
        : groups.map(g => `
          <div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid var(--border);font-size:12px">
            <span>${statusDot(g.lag || 0)}<span style="color:var(--text-primary)">${g.name}</span></span>
            <span style="color:var(--text-secondary)">${g.consumers} consumer${g.consumers !== 1 ? 's' : ''}</span>
            <span style="color:${(g.lag || 0) > 0 ? '#fbbf24' : 'var(--color-lime)'}">lag ${g.lag ?? 0}</span>
            <span style="color:var(--text-secondary)">pending ${g.pending ?? 0}</span>
          </div>`).join('')}
    </div>`;
}

function pendingTable(ss) {
  const allPending = [
    ...ss.circuit.pending_jobs.map(j => ({ ...j, stream: 'circuit' })),
    ...ss.vector.pending_jobs.map(j  => ({ ...j, stream: 'vector'  })),
  ];
  if (allPending.length === 0) {
    return `<div class="empty-state" style="color:var(--color-lime)">Queue is clear ✓</div>`;
  }
  return `
    <div class="table-wrap">
      <table>
        <thead><tr>
          <th>Stream</th><th>Job ID</th><th>Type</th><th>Repo</th><th>Queued</th>
        </tr></thead>
        <tbody>
          ${allPending.map(j => `<tr>
            <td style="font-size:11px;color:var(--text-secondary)">${j.stream}</td>
            <td style="font-family:monospace;font-size:11px">${(j.job_id || '—').slice(0, 8)}</td>
            <td style="font-size:11px">${j.type || '—'}</td>
            <td style="font-size:11px;color:var(--text-secondary)">${j.repo || '—'}</td>
            <td style="font-size:11px;color:var(--text-secondary)">${timeAgo(j.created_at)}</td>
          </tr>`).join('')}
        </tbody>
      </table>
    </div>`;
}

function recentRunsTable(runs) {
  if (!runs || runs.length === 0) {
    return `<div class="empty-state">No runs yet</div>`;
  }
  return `
    <div class="table-wrap">
      <table>
        <thead><tr>
          <th>Job ID</th><th>Type</th><th>Status</th><th>Cost</th><th>Duration</th><th>When</th>
        </tr></thead>
        <tbody>
          ${runs.map(r => {
            const dur = r.started_at && r.ended_at
              ? Math.round((new Date(r.ended_at) - new Date(r.started_at)) / 1000) + 's'
              : r.status === 'running' ? '⏱' : '—';
            return `<tr>
              <td style="font-family:monospace;font-size:11px">${r.id.slice(0, 8)}</td>
              <td style="font-size:11px;color:var(--text-secondary)">${r.type || r.agent_name || '—'}</td>
              <td>${statusBadge(r.status)}</td>
              <td style="font-family:var(--font-instrument)">${fmtCost(r.cost)}</td>
              <td style="font-size:12px;font-family:var(--font-instrument)">${dur}</td>
              <td style="font-size:11px;color:var(--text-secondary)">${timeAgo(r.started_at)}</td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>
    </div>`;
}
