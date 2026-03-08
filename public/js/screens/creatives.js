import { get } from '../api.js';

let _refreshTimer = null;

export function renderCreatives() {
  const el = document.getElementById('screen-creatives');
  el.innerHTML = `<div class="loading">Loading creative data…</div>`;
  _load(el);

  if (_refreshTimer) clearInterval(_refreshTimer);
  _refreshTimer = setInterval(() => _load(el), 60_000);
}

export function destroyCreatives() {
  if (_refreshTimer) {
    clearInterval(_refreshTimer);
    _refreshTimer = null;
  }
}

async function _load(el) {
  try {
    const data = await get('/api/creatives');
    if (!Array.isArray(data)) {
      el.innerHTML = degraded('Creatives', 'Unexpected response from /api/creatives');
      return;
    }
    el.innerHTML = renderScreen(data);

    // Wire historical toggle
    const toggleBtn = el.querySelector('#btn-historical-toggle');
    const histBody  = el.querySelector('#historical-body');
    if (toggleBtn && histBody) {
      toggleBtn.addEventListener('click', () => {
        const hidden = histBody.style.display === 'none';
        histBody.style.display = hidden ? '' : 'none';
        toggleBtn.textContent  = hidden ? '▾ Historical (collapse)' : '▸ Historical';
      });
    }
  } catch (err) {
    el.innerHTML = degraded('Creatives', err.message);
  }
}

// ── Screen renderer ───────────────────────────────────────────────────────────

function renderScreen(log) {
  const organicQueue  = log.filter(c => c.status === 'organic-test');
  const activePaid    = log.filter(c => c.status === 'paid-test');
  const evergreen     = log.filter(c => c.status === 'evergreen');
  const historical    = log.filter(c => c.status === 'killed' || c.status === 'organic-killed' || c.status === 'paused')
                           .sort((a, b) => {
                             const da = a.paid_tests?.[0]?.end || a.posted_at || '';
                             const db = b.paid_tests?.[0]?.end || b.posted_at || '';
                             return db.localeCompare(da);
                           });

  // KPI values
  const activeTestCount  = activePaid.length;
  const totalDailyBudget = activePaid.reduce((s, c) => {
    const last = c.paid_tests?.[c.paid_tests.length - 1];
    return s + (last?.budget_day || 0);
  }, 0);

  const bestCpa = log.reduce((best, c) => {
    for (const t of c.paid_tests || []) {
      const cpa = t.result?.cpa;
      if (cpa && cpa > 0 && (best === null || cpa < best)) return cpa;
    }
    return best;
  }, null);

  const gateQueue = organicQueue.length;

  return `
<div class="canvas-inner">

  <div class="screen-header" style="padding-top:8px;margin-bottom:24px">
    <div class="screen-title" style="font-size:28px;font-weight:600;letter-spacing:-0.02em">Creatives</div>
    <div class="screen-subtitle" style="margin-top:8px">Ad creative testing pipeline — organic gate → paid test → evergreen</div>
  </div>

  <!-- KPI strip -->
  <div class="widget-grid" style="gap:24px;margin-bottom:32px">

    <div class="card card-kpi">
      <div class="card-header" style="margin-bottom:8px;padding-bottom:8px">
        <span class="card-title">Active Paid Tests</span>
      </div>
      <div class="kpi-value ${activeTestCount > 0 ? 'kpi-lime' : ''}">${activeTestCount}</div>
      <div class="kpi-label" style="margin-top:12px">Running ad sets</div>
    </div>

    <div class="card card-kpi">
      <div class="card-header" style="margin-bottom:8px;padding-bottom:8px">
        <span class="card-title">Daily Test Budget</span>
      </div>
      <div class="kpi-value">${totalDailyBudget > 0 ? '$' + totalDailyBudget : '—'}</div>
      <div class="kpi-label" style="margin-top:12px">Across active tests</div>
    </div>

    <div class="card card-kpi">
      <div class="card-header" style="margin-bottom:8px;padding-bottom:8px">
        <span class="card-title">Best CPA (all time)</span>
      </div>
      <div class="kpi-value ${bestCpa !== null && bestCpa < 25 ? 'kpi-lime' : bestCpa !== null ? 'kpi-ember' : ''}">${bestCpa !== null ? '$' + bestCpa.toFixed(2) : '—'}</div>
      <div class="kpi-label" style="margin-top:12px">Lowest cost per purchase</div>
    </div>

    <div class="card card-kpi">
      <div class="card-header" style="margin-bottom:8px;padding-bottom:8px">
        <span class="card-title">Organic Gate Queue</span>
      </div>
      <div class="kpi-value ${gateQueue > 0 ? 'kpi-ember' : ''}">${gateQueue}</div>
      <div class="kpi-label" style="margin-top:12px">Awaiting 48h gate</div>
    </div>

  </div>

  <div class="hud-line"></div>

  <!-- Section 2: Organic Gate Queue -->
  <div class="card" style="margin-bottom:24px">
    <div class="card-header">
      <span class="card-title">Organic Gate Queue</span>
      <span style="font-size:12px;color:var(--text-secondary);margin-left:8px">status = organic-test</span>
    </div>
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Creative ID</th>
            <th>Format</th>
            <th>Hook Type</th>
            <th>Posted</th>
            <th>Gate Status</th>
            <th style="text-align:right">Signals Passed</th>
            <th>Action</th>
          </tr>
        </thead>
        <tbody>
          ${organicQueue.length === 0
            ? `<tr><td colspan="7" style="text-align:center;padding:32px;color:var(--text-secondary)">No creatives in organic gate queue</td></tr>`
            : organicQueue.map(c => organicRow(c)).join('')}
        </tbody>
      </table>
    </div>
  </div>

  <!-- Section 3: Active Paid Tests -->
  <div class="card" style="margin-bottom:24px">
    <div class="card-header">
      <span class="card-title">Active Paid Tests</span>
      <span style="font-size:12px;color:var(--text-secondary);margin-left:8px">status = paid-test</span>
    </div>
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Creative ID</th>
            <th style="text-align:center">Tier</th>
            <th>Audience</th>
            <th style="text-align:right">Budget/day</th>
            <th>Start</th>
            <th style="text-align:right">Days Running</th>
            <th>First Read</th>
            <th style="text-align:right">CPA</th>
          </tr>
        </thead>
        <tbody>
          ${activePaid.length === 0
            ? `<tr><td colspan="8" style="text-align:center;padding:32px;color:var(--text-secondary)">No active paid tests</td></tr>`
            : activePaid.map(c => paidTestRow(c)).join('')}
        </tbody>
      </table>
    </div>
  </div>

  <!-- Section 4: Evergreen Stack -->
  <div class="card" style="margin-bottom:24px">
    <div class="card-header">
      <span class="card-title">Evergreen Stack</span>
      <span style="font-size:12px;color:var(--text-secondary);margin-left:8px">status = evergreen</span>
    </div>
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Creative ID</th>
            <th>Format</th>
            <th style="text-align:right">Best CPA</th>
            <th style="text-align:right">Best ROAS</th>
            <th>Audience</th>
            <th>Notes</th>
          </tr>
        </thead>
        <tbody>
          ${evergreen.length === 0
            ? `<tr><td colspan="6" style="text-align:center;padding:32px;color:var(--text-secondary)">No evergreen creatives</td></tr>`
            : evergreen.map(c => evergreenRow(c)).join('')}
        </tbody>
      </table>
    </div>
  </div>

  <!-- Section 5: Historical (collapsed) -->
  <div class="card">
    <div class="card-header" style="cursor:pointer;user-select:none" id="btn-historical-toggle">
      ▸ Historical
      <span style="font-size:12px;color:var(--text-secondary);margin-left:8px;font-weight:400">killed / paused — ${historical.length} entries</span>
    </div>
    <div id="historical-body" style="display:none">
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Creative ID</th>
              <th>Format</th>
              <th>Status</th>
              <th>Spend</th>
              <th style="text-align:right">Purchases</th>
              <th style="text-align:right">CPA</th>
              <th style="text-align:right">ROAS</th>
              <th>Decision</th>
              <th>Notes</th>
            </tr>
          </thead>
          <tbody>
            ${historical.length === 0
              ? `<tr><td colspan="9" style="text-align:center;padding:32px;color:var(--text-secondary)">No historical data</td></tr>`
              : historical.map(c => historicalRow(c)).join('')}
          </tbody>
        </table>
      </div>
    </div>
  </div>

</div>`;
}

// ── Row renderers ─────────────────────────────────────────────────────────────

function organicRow(c) {
  const gate       = c.organic_gate || {};
  const signals    = gate.signals_passed;
  const qualified  = gate.qualified;
  const gateStatus = qualified === true  ? `<span style="color:var(--color-lime);font-weight:600">qualified</span>` :
                     qualified === false ? `<span style="color:var(--color-red)">not qualified</span>` :
                     `<span style="color:var(--color-ember)">pending</span>`;
  const signalBadge = signals !== null && signals !== undefined
    ? `<span style="font-weight:600;color:${signals >= 4 ? 'var(--color-lime)' : signals >= 2 ? 'var(--color-ember)' : 'var(--color-red)'}">${signals}/5</span>`
    : '—';

  const actionLabel = qualified === true
    ? `<span style="color:var(--color-lime);font-size:12px">ready for paid test</span>`
    : `<span style="color:var(--text-secondary);font-size:12px">awaiting gate</span>`;

  return `<tr>
    <td style="font-weight:500;font-family:var(--font-instrument)">${c.creative_id}</td>
    <td><span class="badge">${c.format}</span></td>
    <td><span class="badge">${c.hook_type}</span></td>
    <td style="color:var(--text-secondary);font-size:12px">${fmt_date(c.posted_at)}</td>
    <td>${gateStatus}</td>
    <td style="text-align:right">${signalBadge}</td>
    <td>${actionLabel}</td>
  </tr>`;
}

function paidTestRow(c) {
  const lastTest = c.paid_tests?.[c.paid_tests.length - 1];
  if (!lastTest) return `<tr><td colspan="8" style="color:var(--text-secondary)">${c.creative_id} — no test data</td></tr>`;

  const daysRunning = lastTest.start
    ? Math.floor((Date.now() - new Date(lastTest.start)) / 86400_000)
    : '—';

  const cpa = lastTest.result?.cpa;
  const cpaStr = cpa ? `<span style="color:${cpa < 25 ? 'var(--color-lime)' : cpa < 40 ? 'var(--color-ember)' : 'var(--color-red)'};font-weight:600">$${cpa.toFixed(2)}</span>` : '—';

  return `<tr>
    <td style="font-weight:500;font-family:var(--font-instrument)">${c.creative_id}</td>
    <td style="text-align:center"><span class="badge">T${lastTest.tier || 1}</span></td>
    <td style="font-size:12px;color:var(--text-secondary)">${lastTest.audience || '—'}</td>
    <td style="text-align:right;font-family:var(--font-instrument)">$${lastTest.budget_day || '—'}</td>
    <td style="font-size:12px;color:var(--text-secondary)">${fmt_date(lastTest.start)}</td>
    <td style="text-align:right">${daysRunning}d</td>
    <td style="font-size:12px;color:var(--text-secondary)">${fmt_date(lastTest.first_read)}</td>
    <td style="text-align:right">${cpaStr}</td>
  </tr>`;
}

function evergreenRow(c) {
  const bestCpa  = c.paid_tests?.reduce((b, t) => {
    const cpa = t.result?.cpa;
    return cpa && cpa > 0 && (b === null || cpa < b) ? cpa : b;
  }, null);

  const bestRoas = c.paid_tests?.reduce((b, t) => {
    const roas = t.result?.roas;
    return roas && (b === null || roas > b) ? roas : b;
  }, null);

  const lastTest = c.paid_tests?.[c.paid_tests.length - 1];
  const audience = lastTest?.audience || '—';

  return `<tr>
    <td style="font-weight:500;font-family:var(--font-instrument)">${c.creative_id}</td>
    <td><span class="badge">${c.format}</span></td>
    <td style="text-align:right;font-family:var(--font-instrument);color:${bestCpa !== null && bestCpa < 25 ? 'var(--color-lime)' : 'var(--text-primary)'};font-weight:${bestCpa !== null ? '600' : '400'}">${bestCpa !== null ? '$' + bestCpa.toFixed(2) : '—'}</td>
    <td style="text-align:right;font-family:var(--font-instrument);color:${bestRoas !== null && bestRoas >= 2 ? 'var(--color-lime)' : 'var(--text-primary)'};font-weight:${bestRoas !== null ? '600' : '400'}">${bestRoas !== null ? bestRoas.toFixed(2) + 'x' : '—'}</td>
    <td style="font-size:12px;color:var(--text-secondary)">${audience}</td>
    <td style="font-size:12px;color:var(--text-secondary);max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${c.notes || ''}">${c.notes || '—'}</td>
  </tr>`;
}

function historicalRow(c) {
  const lastTest = c.paid_tests?.[c.paid_tests.length - 1];
  const result   = lastTest?.result;
  const decision = result?.decision
    ? `<span style="color:${result.decision === 'kill' ? 'var(--color-red)' : result.decision === 'scale' ? 'var(--color-lime)' : 'var(--color-ember)'};font-weight:600">${result.decision}</span>`
    : '—';

  return `<tr>
    <td style="font-weight:500;font-family:var(--font-instrument)">${c.creative_id}</td>
    <td><span class="badge">${c.format}</span></td>
    <td style="color:var(--color-red);font-size:12px">${c.status}</td>
    <td style="font-family:var(--font-instrument)">${result?.spend != null ? '$' + result.spend.toFixed(2) : '—'}</td>
    <td style="text-align:right">${result?.purchases ?? '—'}</td>
    <td style="text-align:right;font-family:var(--font-instrument)">${result?.cpa != null ? '$' + result.cpa.toFixed(2) : '—'}</td>
    <td style="text-align:right;font-family:var(--font-instrument)">${result?.roas != null ? result.roas.toFixed(2) + 'x' : '—'}</td>
    <td>${decision}</td>
    <td style="font-size:12px;color:var(--text-secondary);max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${c.notes || ''}">${c.notes || '—'}</td>
  </tr>`;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmt_date(d) {
  if (!d) return '—';
  const s = typeof d === 'string' ? d : new Date(d).toISOString();
  return s.slice(0, 10);
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
