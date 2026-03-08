import { get, fmtCost, humanTime } from '../api.js';

export async function renderCosts() {
  const el = document.getElementById('screen-costs');
  el.innerHTML = `<div class="loading">Loading cost data…</div>`;

  try {
    const d = await get('/api/costs');

    if (d.error) {
      el.innerHTML = degraded('Costs', d.message);
      return;
    }

    const bar   = budgetBarCls(d.budgetPct);
    const burnStr = d.burnRatePerHr > 0
      ? `$${d.burnRatePerHr.toFixed(2)}/hr`
      : '—';
    const exhaustStr = d.exhaustAt
      ? exhaustLabel(d.exhaustAt, d.budgetPct)
      : 'Under budget';

    // Sparkline max for scaling
    const maxSpend = d.trend.length
      ? Math.max(...d.trend.map(t => t.spend), 0.01)
      : 1;

    el.innerHTML = `
<div class="canvas-inner">

  <div class="screen-header" style="padding-top:8px;margin-bottom:24px">
    <div class="screen-title" style="font-size:28px;font-weight:600;letter-spacing:-0.02em">Costs</div>
    <div class="screen-subtitle" style="margin-top:8px">Ad spend vs $${d.dailyBudget}/day budget — live from Meta</div>
  </div>

  <!-- KPI row -->
  <div class="widget-grid" style="gap:24px;margin-bottom:32px">

    <!-- Daily budget -->
    <div class="card card-kpi">
      <div class="card-header" style="margin-bottom:8px;padding-bottom:8px">
        <span class="card-title">Today's Spend</span>
        <span style="font-size:11px;color:var(--text-secondary)">of $${d.dailyBudget}</span>
      </div>
      <div class="kpi-value kpi-accent kpi-hero">${fmtCost(d.totalToday)}</div>
      <div class="budget-bar-track" style="margin-top:10px">
        <div class="budget-bar-fill ${bar}" style="width:${d.budgetPct}%"></div>
        <div class="budget-bar-tick" style="left:50%"><span class="budget-bar-tick-label">50%</span></div>
        <div class="budget-bar-tick" style="left:80%"><span class="budget-bar-tick-label">80%</span></div>
        <div class="budget-bar-tick" style="left:100%"><span class="budget-bar-tick-label">100%</span></div>
      </div>
      <div class="kpi-label">${d.budgetPct}% of daily budget</div>
    </div>

    <!-- Burn rate -->
    <div class="card card-kpi">
      <div class="card-header" style="margin-bottom:8px;padding-bottom:8px">
        <span class="card-title">Burn Rate</span>
      </div>
      <div class="kpi-value ${d.burnRatePerHr > 4 ? 'kpi-ember' : ''}">${burnStr}</div>
      <div class="kpi-label" style="margin-top:12px">${exhaustStr}</div>
    </div>

    <!-- 7d total -->
    <div class="card card-kpi">
      <div class="card-header" style="margin-bottom:8px;padding-bottom:8px">
        <span class="card-title">7d Total</span>
      </div>
      <div class="kpi-value">${fmtCost(d.campaigns.reduce((s,c)=>s+c.spend7d,0))}</div>
      <div class="kpi-label" style="margin-top:12px">${d.campaigns.length} active campaigns</div>
    </div>

    <!-- Budget health -->
    <div class="card card-kpi">
      <div class="card-header" style="margin-bottom:8px;padding-bottom:8px">
        <span class="card-title">Budget Health</span>
      </div>
      <div class="kpi-value ${bar === 'red' ? 'kpi-red' : bar === 'ember' ? 'kpi-ember' : 'kpi-lime'}" style="font-size:24px;text-transform:capitalize">
        ${bar === 'red' ? 'Critical' : bar === 'ember' ? 'Caution' : 'On Track'}
      </div>
      <div class="kpi-label" style="margin-top:12px">${d.budgetPct}% consumed</div>
    </div>

  </div>

  <div class="hud-line"></div>

  <!-- 7-day sparkline -->
  ${d.trend.length ? `
  <div class="card" style="margin-bottom:24px">
    <div class="card-header"><span class="card-title">7-Day Spend Trend</span></div>
    <div style="display:flex;align-items:flex-end;gap:6px;height:80px;padding:8px 0">
      ${d.trend.map(t => {
        const h   = Math.max(Math.round((t.spend / maxSpend) * 70), 2);
        const cls = t.spend > d.dailyBudget * 0.8 ? 'var(--color-ember)' : 'var(--color-teal)';
        return `<div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:4px">
          <div style="font-size:9px;color:var(--text-secondary)">${fmtCost(t.spend)}</div>
          <div style="width:100%;height:${h}px;background:${cls};border-radius:2px;opacity:0.8"></div>
          <div style="font-size:9px;color:var(--text-secondary)">${t.date ? t.date.slice(5) : ''}</div>
        </div>`;
      }).join('')}
    </div>
  </div>` : ''}

  <!-- Campaign breakdown -->
  <div class="card">
    <div class="card-header"><span class="card-title">Campaign Breakdown</span></div>
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Campaign</th>
            <th>Status</th>
            <th style="text-align:right">Daily Budget</th>
            <th style="text-align:right">Today</th>
            <th style="text-align:right">7d Spend</th>
            <th style="text-align:right">Budget %</th>
          </tr>
        </thead>
        <tbody>
          ${d.campaigns.length === 0
            ? `<tr><td colspan="6" style="text-align:center;padding:32px;color:var(--text-secondary)">No campaigns found</td></tr>`
            : d.campaigns.map(c => {
              const pct = c.dailyBudget ? Math.round((c.spendToday / c.dailyBudget) * 100) : null;
              const pctStr = pct !== null ? `${pct}%` : '—';
              const pctColor = pct !== null
                ? (pct > 90 ? 'var(--color-red)' : pct > 70 ? 'var(--color-ember)' : 'var(--color-lime)')
                : 'var(--text-secondary)';
              return `<tr>
                <td style="max-width:260px;font-weight:500">${c.name}</td>
                <td><span class="badge badge-${c.status === 'ACTIVE' ? 'ready' : 'waiting'}">${c.status}</span></td>
                <td style="text-align:right;font-family:var(--font-instrument)">${c.dailyBudget ? fmtCost(c.dailyBudget) : '—'}</td>
                <td style="text-align:right;font-family:var(--font-instrument)">${fmtCost(c.spendToday)}</td>
                <td style="text-align:right;font-family:var(--font-instrument)">${fmtCost(c.spend7d)}</td>
                <td style="text-align:right;font-family:var(--font-instrument);color:${pctColor}">${pctStr}</td>
              </tr>`;
            }).join('')}
        </tbody>
      </table>
    </div>
  </div>

</div>`;

  } catch (err) {
    el.innerHTML = degraded('Costs', err.message);
  }
}

// ── Helpers ───────────────────────────────────────────

function budgetBarCls(pct) {
  return pct >= 90 ? 'red' : pct >= 70 ? 'ember' : 'teal';
}

function exhaustLabel(isoStr, pct) {
  if (pct >= 100) return 'Budget exhausted';
  const d = new Date(isoStr);
  const h = d.getUTCHours().toString().padStart(2, '0');
  const m = d.getUTCMinutes().toString().padStart(2, '0');
  return `Budget exhausted ~${h}:${m} UTC at current pace`;
}

function degraded(title, msg) {
  return `<div class="canvas-inner">
    <div class="screen-header" style="padding-top:8px;margin-bottom:24px">
      <div class="screen-title" style="font-size:28px;font-weight:600">${title}</div>
    </div>
    <div class="card" style="border-color:var(--color-ember)">
      <div style="color:var(--color-ember);font-weight:600;margin-bottom:8px">⚠ Data unavailable</div>
      <div style="font-size:13px;color:var(--text-secondary)">${msg}</div>
    </div>
  </div>`;
}
