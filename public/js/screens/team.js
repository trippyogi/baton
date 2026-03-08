import { get } from '../api.js';

export async function renderTeam() {
  const el = document.getElementById('screen-team');
  el.innerHTML = `<div class="loading">Loading team…</div>`;

  try {
    const { agents } = await get('/api/team');

    el.innerHTML = `
<div class="canvas-inner">

  <div class="screen-header" style="padding-top:8px;margin-bottom:24px">
    <div class="screen-title" style="font-size:28px;font-weight:600;letter-spacing:-0.02em">Team</div>
    <div class="screen-subtitle" style="margin-top:8px">Active agents in the Vector / Circuit system</div>
  </div>

  <div class="team-grid">
    ${agents.map(agentCard).join('')}
  </div>

</div>`;

  } catch (err) {
    el.innerHTML = `<div class="canvas-inner">
      <div class="screen-header" style="padding-top:8px;margin-bottom:24px">
        <div class="screen-title" style="font-size:28px;font-weight:600">Team</div>
      </div>
      <div class="card" style="border-color:var(--color-red)">
        <div style="color:var(--color-red);font-weight:600;margin-bottom:8px">Error</div>
        <div style="font-size:13px;color:var(--text-secondary)">${err.message}</div>
      </div>
    </div>`;
  }
}

function agentCard(a) {
  const statusDot = a.status === 'online'
    ? `<span class="status-dot healthy"></span>`
    : `<span class="status-dot offline"></span>`;

  return `
<div class="card card-kpi" style="border-radius:var(--radius-card)">

  <!-- Header -->
  <div style="display:flex;align-items:center;gap:14px;margin-bottom:20px">
    <div style="width:52px;height:52px;border-radius:50%;background:color-mix(in srgb,var(--accent) 12%,var(--bg-surface));display:flex;align-items:center;justify-content:center;font-size:24px;flex-shrink:0">
      ${a.emoji}
    </div>
    <div>
      <div style="font-size:20px;font-weight:700;color:var(--text-primary)">${a.name}</div>
      <div style="font-size:12px;color:var(--text-secondary);margin-top:2px">${a.role}</div>
    </div>
    <div style="margin-left:auto;display:flex;align-items:center;gap:6px;font-size:12px;color:var(--text-secondary)">
      ${statusDot}
      ${a.status}
    </div>
  </div>

  <!-- Description -->
  <div style="font-size:13px;color:var(--text-secondary);line-height:1.6;margin-bottom:20px;padding-bottom:16px;border-bottom:1px solid var(--border)">
    ${a.description}
  </div>

  <!-- Metadata grid -->
  <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
    ${metaField('Discord ID', `<@${a.id}>`, 'font-family:var(--font-instrument);font-size:12px')}
    ${metaField('Model', a.model)}
    ${metaField('Channel', a.channel)}
    ${metaField('Workspace', a.workspace, 'font-family:var(--font-instrument);font-size:11px;word-break:break-all')}
    <div style="grid-column:1/-1">
      ${metaField('Session Key', a.sessionKey, 'font-family:var(--font-instrument);font-size:11px;word-break:break-all;color:var(--color-teal)')}
    </div>
  </div>

</div>`;
}

function metaField(label, value, valueStyle = '') {
  return `<div>
    <div style="font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:0.1em;color:var(--text-secondary);margin-bottom:4px">${label}</div>
    <div style="font-size:13px;color:var(--text-primary);${valueStyle}">${value}</div>
  </div>`;
}
