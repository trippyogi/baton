import { get, fmtCost } from '../api.js';

export async function renderPerformance() {
  const el = document.getElementById('screen-performance');
  el.innerHTML = `<div class="loading">Loading performance data…</div>`;

  try {
    const d = await get('/api/performance');

    if (d.error) {
      el.innerHTML = degraded('Performance', d.message);
      return;
    }

    const { kpis, campaigns } = d;

    el.innerHTML = `
<div class="canvas-inner">

  <div class="screen-header" style="padding-top:8px;margin-bottom:24px">
    <div class="screen-title" style="font-size:28px;font-weight:600;letter-spacing:-0.02em">Performance</div>
    <div class="screen-subtitle" style="margin-top:8px">Campaign KPIs — last 7 days — live from Meta</div>
  </div>

  <!-- KPI row -->
  <div class="widget-grid" style="gap:24px;margin-bottom:32px">

    <div class="card card-kpi">
      <div class="card-header" style="margin-bottom:8px;padding-bottom:8px">
        <span class="card-title">Total ROAS (7d)</span>
      </div>
      <div class="kpi-value ${roasCls(kpis.totalRoas)}">${kpis.totalRoas !== null ? kpis.totalRoas.toFixed(2) + 'x' : '—'}</div>
      <div class="kpi-label" style="margin-top:12px">Revenue / spend ratio</div>
    </div>

    <div class="card card-kpi">
      <div class="card-header" style="margin-bottom:8px;padding-bottom:8px">
        <span class="card-title">Best Campaign ROAS</span>
      </div>
      <div class="kpi-value ${roasCls(kpis.bestRoas)}">${kpis.bestRoas !== null ? kpis.bestRoas.toFixed(2) + 'x' : '—'}</div>
      <div class="kpi-label" style="margin-top:12px">
        ${kpis.bestRoas !== null
          ? campaigns.find(c => c.roas !== null && Math.abs(c.roas - kpis.bestRoas) < 0.01)?.name || ''
          : 'No purchase data'}
      </div>
    </div>

    <div class="card card-kpi">
      <div class="card-header" style="margin-bottom:8px;padding-bottom:8px">
        <span class="card-title">Avg CTR</span>
      </div>
      <div class="kpi-value ${kpis.avgCtr !== null && kpis.avgCtr < 1.0 ? 'kpi-ember' : ''}">${kpis.avgCtr !== null ? kpis.avgCtr.toFixed(2) + '%' : '—'}</div>
      <div class="kpi-label" style="margin-top:12px">${kpis.avgCtr !== null && kpis.avgCtr < 1.0 ? '⚠️ Below 1% threshold' : 'Click-through rate'}</div>
    </div>

    <div class="card card-kpi">
      <div class="card-header" style="margin-bottom:8px;padding-bottom:8px">
        <span class="card-title">Total Impressions</span>
      </div>
      <div class="kpi-value">${fmtImpress(kpis.totalImpressions)}</div>
      <div class="kpi-label" style="margin-top:12px">Last 7 days</div>
    </div>

  </div>

  <div class="hud-line"></div>

  <!-- Campaign performance table -->
  <div class="card">
    <div class="card-header"><span class="card-title">Campaign Performance — Last 7 Days</span></div>
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Campaign</th>
            <th style="text-align:right">Spend</th>
            <th style="text-align:right">Revenue</th>
            <th style="text-align:right">ROAS</th>
            <th style="text-align:right">CTR</th>
            <th style="text-align:right">CPM</th>
            <th style="text-align:right">Impressions</th>
            <th style="text-align:right">Clicks</th>
          </tr>
        </thead>
        <tbody>
          ${campaigns.length === 0
            ? `<tr><td colspan="8" style="text-align:center;padding:32px;color:var(--text-secondary)">No campaign data for last 7 days</td></tr>`
            : campaigns.map(c => roasRow(c)).join('')}
        </tbody>
      </table>
    </div>
  </div>

</div>`;

  } catch (err) {
    el.innerHTML = degraded('Performance', err.message);
  }
}

// ── Helpers ───────────────────────────────────────────

function roasCls(roas) {
  if (roas === null) return '';
  if (roas >= 2)    return 'kpi-lime';
  if (roas >= 1)    return 'kpi-ember';
  return 'kpi-red';
}

function roasColor(roas) {
  if (roas === null) return 'var(--text-secondary)';
  if (roas >= 2)    return 'var(--color-lime)';
  if (roas >= 1)    return 'var(--color-ember)';
  return 'var(--color-red)';
}

function fmtImpress(n) {
  if (!n) return '—';
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000)    return `${(n / 1000).toFixed(1)}K`;
  return String(n);
}

function roasRow(c) {
  const roasVal   = c.roas !== null ? c.roas.toFixed(2) + 'x' : '—';
  const ctrVal    = c.ctr  !== null ? c.ctr.toFixed(2) + '%' : '—';
  const ctrWarn   = c.ctr  !== null && c.ctr < 1.0;
  const cpmVal    = c.cpm  !== null ? fmtCost(c.cpm) : '—';
  return `<tr>
    <td style="max-width:260px;font-weight:500">${c.name}</td>
    <td style="text-align:right;font-family:var(--font-instrument)">${fmtCost(c.spend)}</td>
    <td style="text-align:right;font-family:var(--font-instrument)">${c.revenue > 0 ? fmtCost(c.revenue) : '—'}</td>
    <td style="text-align:right;font-family:var(--font-instrument);color:${roasColor(c.roas)};font-weight:600">${roasVal}</td>
    <td style="text-align:right;font-family:var(--font-instrument);color:${ctrWarn ? 'var(--color-ember)' : ''}">${ctrVal}${ctrWarn ? ' ⚠️' : ''}</td>
    <td style="text-align:right;font-family:var(--font-instrument)">${cpmVal}</td>
    <td style="text-align:right;font-family:var(--font-instrument)">${fmtImpress(c.impressions)}</td>
    <td style="text-align:right;font-family:var(--font-instrument)">${c.clicks ? c.clicks.toLocaleString() : '—'}</td>
  </tr>`;
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
