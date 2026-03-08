import { get, createSSE, humanTime, fmtCost, fmtTokens } from '../api.js';
import { updateHealthDot } from '../components/topbar.js';

let sseConn       = null;
let alertAbort    = null;  // AbortController for alert delegation listener

// ── Helpers ───────────────────────────────────────────

function computeHealth(alerts) {
  if (alerts.some(a => a.severity === 'critical'))
    return { cls: 'kpi-red',   label: 'Critical',  dotCls: 'degraded' };
  if (alerts.some(a => a.severity === 'warning'))
    return { cls: 'kpi-ember', label: 'Degraded',  dotCls: 'degraded' };
  return   { cls: 'kpi-lime',  label: 'Healthy',   dotCls: 'healthy' };
}

function fmtDuration(started, ended) {
  if (!started) return '—';
  const ms = (ended ? new Date(ended) : new Date()) - new Date(started);
  if (ms < 0) return '—';
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

function budgetBar(spent, budget) {
  const pct   = Math.min(Math.round((spent / budget) * 100), 100);
  const cls   = pct < 70 ? 'teal' : pct < 90 ? 'ember' : 'red';
  const color = pct < 70 ? 'var(--color-teal)' : pct < 90 ? 'var(--color-ember)' : 'var(--color-red)';
  return { pct, cls, color };
}

function buildRunAnomalyFlags(runs) {
  const done = runs.filter(r => r.ended_at && r.cost > 0);
  if (done.length < 2) return new Set();
  const avgCost = done.reduce((s, r) => s + r.cost, 0) / done.length;
  const avgDur  = done.reduce((s, r) => s + (new Date(r.ended_at) - new Date(r.started_at)), 0) / done.length;
  return new Set(
    done.filter(r => {
      const dur     = new Date(r.ended_at) - new Date(r.started_at);
      const costHot = r.cost  > avgCost * 1.5;
      const durHot  = dur     > avgDur  * 1.5 && avgDur > 0;
      return costHot || durHot;
    }).map(r => r.id)
  );
}

// ── Main render ───────────────────────────────────────

export async function renderOverview() {
  const el = document.getElementById('screen-overview');
  el.innerHTML = `<div class="loading">Loading command deck…</div>`;

  try {
    const d = await get('/api/overview');
    const health    = computeHealth(d.alerts);
    const anomalies = buildRunAnomalyFlags(d.recentRuns);
    const BUDGET    = 75;
    const bar       = budgetBar(d.costToday, BUDGET);

    updateHealthDot(health.dotCls);

    // Spend delta vs yesterday
    const delta     = d.costYesterday > 0
      ? ((d.costToday - d.costYesterday) / d.costYesterday * 100).toFixed(0)
      : null;
    const deltaStr  = delta === null ? '—'
      : delta >= 0 ? `+${delta}%` : `${delta}%`;
    const deltaCls  = delta !== null && Number(delta) > 15
      ? 'color:var(--color-ember)'
      : 'color:var(--text-secondary)';

    // Command strip: anomaly indicator
    const hasRunAnomaly = anomalies.size > 0;
    const hasBudgetWarn = bar.pct >= 70;
    const showAnomaly   = hasRunAnomaly || hasBudgetWarn;

    // Queue depth = ready tasks
    const queueDepth = d.taskStats.ready || 0;

    el.innerHTML = `
<div class="canvas-inner">

  <!-- Screen Header -->
  <div class="screen-header" style="padding-top:8px;margin-bottom:24px">
    <div class="screen-title" style="font-size:28px;font-weight:600;letter-spacing:-0.02em">Command Deck</div>
    <div class="screen-subtitle" style="margin-top:8px">${new Date().toLocaleString()} — Real-time operational status</div>
  </div>

  <!-- Command Strip -->
  <div class="command-strip">
    <div class="command-strip-item">
      <span class="status-dot ${health.dotCls}"></span>
      <span>Vector</span>
      <span class="command-strip-val">${health.label}</span>
    </div>
    <div class="command-strip-sep"></div>
    <div class="command-strip-item">
      <span>Queue</span>
      <span class="command-strip-val">${queueDepth}</span>
    </div>
    <div class="command-strip-sep"></div>
    <div class="command-strip-item">
      <span>Spend delta</span>
      <span class="command-strip-val" style="${deltaCls}">${deltaStr}</span>
    </div>
    <div class="command-strip-sep"></div>
    <div class="command-strip-item">
      <span>Budget</span>
      <span class="command-strip-val" style="color:var(--${bar.cls === 'teal' ? 'color-teal' : bar.cls === 'ember' ? 'color-ember' : 'color-red'})">${bar.pct}%</span>
    </div>
    ${showAnomaly ? `
    <div class="command-strip-anomaly">
      <span>⚠</span>
      <span>${hasRunAnomaly ? 'Run anomaly detected' : 'Budget threshold'}  </span>
    </div>` : ''}
  </div>

  <!-- KPI Row -->
  <div class="widget-grid" style="gap:24px;margin-bottom:32px">

    <!-- KPI 1: Cost Today -->
    <div class="card card-kpi">
      <div class="card-header" style="margin-bottom:8px;padding-bottom:8px">
        <span class="card-title">Cost Today</span>
        <span style="font-size:11px;color:var(--text-secondary)">of $${BUDGET}/day</span>
      </div>
      <div class="kpi-value kpi-accent kpi-hero">${fmtCost(d.costToday)}</div>
      <div class="budget-bar-track">
        <div class="budget-bar-fill ${bar.cls}" style="width:${bar.pct}%"></div>
        <div class="budget-bar-tick" style="left:50%"><span class="budget-bar-tick-label">50%</span></div>
        <div class="budget-bar-tick" style="left:80%"><span class="budget-bar-tick-label">80%</span></div>
        <div class="budget-bar-tick" style="left:100%"><span class="budget-bar-tick-label">100%</span></div>
      </div>
      <div class="kpi-label">${bar.pct}% of daily budget — ${d.costYesterday > 0 ? fmtCost(d.costYesterday) + ' yesterday' : 'no data yesterday'}</div>
    </div>

    <!-- KPI 2: Active Runs -->
    <div class="card card-kpi">
      <div class="card-header" style="margin-bottom:8px;padding-bottom:8px">
        <span class="card-title">Active Runs</span>
      </div>
      <div class="kpi-value">${d.activeRuns.length}</div>
      <div class="kpi-microgrid">
        <div class="kpi-micro-item">
          <div class="kpi-micro-val" style="color:var(--color-lime)">${d.activeRuns.length}</div>
          <div class="kpi-micro-label">Running</div>
        </div>
        <div class="kpi-micro-item">
          <div class="kpi-micro-val">${d.pendingRuns || 0}</div>
          <div class="kpi-micro-label">Queued</div>
        </div>
        <div class="kpi-micro-item">
          <div class="kpi-micro-val" style="${(d.taskStats.waiting || 0) > 0 ? 'color:var(--color-ember)' : ''}">${d.taskStats.waiting || 0}</div>
          <div class="kpi-micro-label">Blocked</div>
        </div>
      </div>
    </div>

    <!-- KPI 3: Task Pressure -->
    <div class="card card-kpi">
      <div class="card-header" style="margin-bottom:8px;padding-bottom:8px">
        <span class="card-title">Task Pressure</span>
      </div>
      <div class="kpi-value ${(d.taskStats.waiting || 0) + (d.taskStats.overdue || 0) > 0 ? 'kpi-ember' : ''}">${(d.taskStats.waiting || 0) + (d.taskStats.overdue || 0)}</div>
      <div class="kpi-microgrid">
        <div class="kpi-micro-item">
          <div class="kpi-micro-val" style="${(d.taskStats.waiting || 0) > 0 ? 'color:var(--color-ember)' : ''}">${d.taskStats.waiting || 0}</div>
          <div class="kpi-micro-label">Blocked</div>
        </div>
        <div class="kpi-micro-item">
          <div class="kpi-micro-val" style="${(d.taskStats.overdue || 0) > 0 ? 'color:var(--color-red)' : ''}">${d.taskStats.overdue || 0}</div>
          <div class="kpi-micro-label">Overdue</div>
        </div>
        <div class="kpi-micro-item">
          <div class="kpi-micro-val">—</div>
          <div class="kpi-micro-label">Cycle</div>
        </div>
      </div>
    </div>

    <!-- KPI 4: System Health -->
    <div class="card card-kpi">
      <div class="card-header" style="margin-bottom:8px;padding-bottom:8px">
        <span class="card-title">System Health</span>
      </div>
      <div class="kpi-value ${health.cls}" style="font-size:28px;text-transform:capitalize">${health.label}</div>
      <div class="kpi-microgrid">
        <div class="kpi-micro-item">
          <div class="kpi-micro-val" style="color:var(--color-lime)">—</div>
          <div class="kpi-micro-label">Success</div>
        </div>
        <div class="kpi-micro-item">
          <div class="kpi-micro-val">—</div>
          <div class="kpi-micro-label">Retry</div>
        </div>
        <div class="kpi-micro-item">
          <div class="kpi-micro-val" style="${d.alerts.length > 0 ? 'color:var(--color-ember)' : ''}">${d.alerts.length}</div>
          <div class="kpi-micro-label">Alerts</div>
        </div>
      </div>
    </div>

  </div>

  <div class="hud-line"></div>

  <!-- Quick Controls -->
  <div class="card" style="margin-bottom:24px">
    <div class="card-header"><span class="card-title">Quick Controls</span></div>
    <div style="display:flex;gap:8px;flex-wrap:nowrap;align-items:center">
      <a href="#/tasks" class="btn btn-ghost btn-sm">+ New Task</a>
      <a href="#/runs"  class="btn btn-ghost btn-sm">View Runs</a>
      <a href="#/board" class="btn btn-ghost btn-sm">View Board</a>
      <button class="btn btn-ghost btn-sm" id="btn-resolve-info" style="margin-left:auto">Resolve All Info Alerts</button>
    </div>
  </div>

  <!-- Priority Queue + Alerts -->
  <div class="widget-grid-wide" style="gap:32px;margin-bottom:32px">

    <div class="card">
      <div class="card-header">
        <span class="card-title">Priority Queue</span>
        <a href="#/tasks" class="btn btn-ghost btn-sm">View all</a>
      </div>
      <div id="priority-queue">
        ${d.priorityQueue.length === 0
          ? '<div class="empty-state"><span class="empty-state-icon">✓</span>Queue clear</div>'
          : d.priorityQueue.map(t => `
            <div style="display:flex;align-items:center;gap:10px;height:48px;padding:0 4px;border-bottom:1px solid color-mix(in srgb,var(--border) 40%,transparent);transition:background 0.1s">
              <span class="badge badge-${t.priority}">${t.priority}</span>
              <span style="flex:1;font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${t.title}</span>
              <span class="badge badge-${t.status}">${t.status.replace('_',' ')}</span>
            </div>`).join('')}
      </div>
    </div>

    <div class="card">
      <div class="card-header">
        <span class="card-title">Alerts</span>
        <span style="font-size:11px;color:var(--text-secondary)">${d.alerts.length} active</span>
      </div>
      ${d.alerts.length === 0
        ? '<div class="empty-state"><span class="empty-state-icon">◎</span>All clear</div>'
        : d.alerts.map(a => `
          <div class="alert-item ${a.severity}">
            <div style="flex:1">
              <div class="alert-msg">${a.message}</div>
              <div class="alert-time">${humanTime(a.created_at)}</div>
            </div>
            <button class="btn btn-ghost btn-sm resolve-alert-btn" style="font-size:11px;opacity:0.7" data-alert-id="${a.id}">Resolve</button>
          </div>`).join('')}
    </div>

  </div>

  <!-- Recent Runs -->
  <div class="card" style="margin-bottom:var(--gap)">
    <div class="card-header">
      <span class="card-title">Recent Runs</span>
      <span id="live-badge" style="font-size:11px;color:var(--color-lime);display:flex;align-items:center;gap:4px">
        <span class="status-dot healthy live-dot"></span> Live
      </span>
    </div>
    <!-- Table header -->
    <div style="display:flex;gap:12px;padding:4px 0 8px;border-bottom:1px solid var(--border);font-size:11px;font-weight:500;text-transform:uppercase;letter-spacing:0.06em;color:var(--text-secondary)">
      <span style="width:80px">Status</span>
      <span style="flex:1">Agent</span>
      <span style="width:56px">Duration</span>
      <span style="width:40px;text-align:right">Retry</span>
      <span style="width:72px;text-align:right">Tokens</span>
      <span style="width:64px;text-align:right">Cost</span>
      <span style="width:72px;text-align:right">When</span>
    </div>
    <div id="recent-runs">
      ${renderRunRows(d.recentRuns, anomalies)}
    </div>
  </div>

</div>`;

    // SSE for live run updates
    if (sseConn) sseConn.close();
    sseConn = createSSE('/api/runs/stream', {
      run_updated: () => refreshRecentRuns(),
      snapshot:    () => {}
    });

    // Event delegation — alert resolve buttons (abort previous listener on re-render)
    if (alertAbort) alertAbort.abort();
    alertAbort = new AbortController();
    el.addEventListener('click', async (e) => {
      const btn = e.target.closest('.resolve-alert-btn');
      if (!btn) return;
      const id = btn.dataset.alertId;
      if (!id) return;
      btn.disabled = true;
      btn.textContent = '…';
      try {
        const { patch } = await import('../api.js');
        await patch(`/api/alerts/${id}/resolve`, {});
        renderOverview();
      } catch(err) {
        btn.disabled = false;
        btn.textContent = 'Resolve';
        console.error(err);
      }
    }, { signal: alertAbort.signal });

    // Wire Resolve All Info Alerts
    const resolveInfoBtn = document.getElementById('btn-resolve-info');
    if (resolveInfoBtn) {
      resolveInfoBtn.onclick = async () => {
        const infoAlerts = d.alerts.filter(a => a.severity === 'info');
        if (!infoAlerts.length) return;
        try {
          const { patch } = await import('../api.js');
          await Promise.all(infoAlerts.map(a => patch(`/api/alerts/${a.id}/resolve`, {})));
          renderOverview();
        } catch(e) { console.error(e); }
      };
    }

  } catch (err) {
    el.innerHTML = `<div class="loading" style="color:var(--color-red)">Error loading command deck: ${err.message}</div>`;
  }
}

// ── Run row renderer ──────────────────────────────────

function renderRunRows(runs, anomalies = new Set()) {
  if (!runs.length) return '<div class="empty-state">No runs yet</div>';
  return runs.map(r => {
    const isAnomaly  = anomalies.has(r.id);
    const retryCount = Array.isArray(r.logs) && r.logs.length > 1 ? r.logs.length - 1 : '—';
    const lastLog    = Array.isArray(r.logs) && r.logs.length
      ? (typeof r.logs[r.logs.length - 1] === 'string'
          ? r.logs[r.logs.length - 1]
          : JSON.stringify(r.logs[r.logs.length - 1]))
      : '';
    const titleAttr  = lastLog ? ` title="${lastLog.replace(/"/g, '&quot;').slice(0, 120)}"` : '';
    return `
      <div class="run-row${isAnomaly ? ' anomaly' : ''}"${titleAttr}>
        <span style="width:80px"><span class="badge badge-${r.status}">${r.status}</span></span>
        <span class="run-agent" style="flex:1">${r.agent_name}${isAnomaly ? ' <span class="run-anomaly-badge">⚡ anomaly</span>' : ''}</span>
        <span class="run-duration" style="width:56px">${fmtDuration(r.started_at, r.ended_at)}</span>
        <span style="width:40px;text-align:right;font-family:var(--font-instrument);font-size:12px;color:${retryCount !== '—' ? 'var(--color-ember)' : 'var(--text-secondary)'}">${retryCount}</span>
        <span class="run-tokens" style="width:72px;text-align:right">${fmtTokens(r.tokens)}</span>
        <span class="run-cost" style="width:64px;text-align:right">${fmtCost(r.cost)}</span>
        <span class="alert-time" style="width:72px;text-align:right">${humanTime(r.started_at)}</span>
      </div>`;
  }).join('');
}

// ── SSE refresh ───────────────────────────────────────

async function refreshRecentRuns() {
  try {
    const d = await get('/api/overview');
    const el = document.getElementById('recent-runs');
    if (!el) return;
    const anomalies = buildRunAnomalyFlags(d.recentRuns);
    el.innerHTML = renderRunRows(d.recentRuns, anomalies);
  } catch {}
}
