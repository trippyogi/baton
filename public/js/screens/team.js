import { get, post } from '../api.js';
import { escapeHtml, escapeAttr } from '../lib/html.js';

const STATUS_HEALTH = {
  idle: 'healthy',
  running: 'healthy',
  reviewing: 'healthy',
  blocked: 'degraded',
  paused: 'degraded',
  failed: 'critical',
  offline: 'critical',
};

export async function renderTeam() {
  const el = document.getElementById('screen-team');
  el.innerHTML = `<div class="loading">Loading team…</div>`;

  try {
    const agents = await get('/api/agents');
    const counts = summarizeAgents(agents);

    el.innerHTML = `
<div class="canvas-inner">

  <div class="screen-header" style="padding-top:8px;margin-bottom:24px">
    <div>
      <div class="screen-title" style="font-size:28px;font-weight:600;letter-spacing:-0.02em">Team</div>
      <div class="screen-subtitle" style="margin-top:8px">Real agent registry for local/private BATON work</div>
    </div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end;align-items:stretch">
      ${summaryPill('Agents', agents.length)}
      ${summaryPill('Idle', counts.idle)}
      ${summaryPill('Running', counts.running)}
      ${summaryPill('Dispatch-ready', counts.dispatchReady)}
      <button class="btn btn-primary" id="btn-new-agent" type="button">+ New local agent</button>
    </div>
  </div>

  <div class="card" style="margin-bottom:18px">
    <div style="font-size:13px;color:var(--text-secondary);line-height:1.6">
      Import private agents with <code>npm run import:local -- local/profile.json</code>, or create a safe local registry entry here. For webhook dispatch, enter an environment variable name such as <code>MY_AGENT_WEBHOOK_URL</code>; do not paste raw URLs or tokens.
    </div>
  </div>

  <div class="team-grid">
    ${agents.length ? agents.map(agentCard).join('') : emptyState()}
  </div>

</div>`;

    document.getElementById('btn-new-agent').onclick = showNewAgentModal;
  } catch (err) {
    el.innerHTML = `<div class="canvas-inner">
      <div class="screen-header" style="padding-top:8px;margin-bottom:24px">
        <div class="screen-title" style="font-size:28px;font-weight:600">Team</div>
      </div>
      <div class="card" style="border-color:var(--color-red)">
        <div style="color:var(--color-red);font-weight:600;margin-bottom:8px">Error</div>
        <div style="font-size:13px;color:var(--text-secondary)">${escapeHtml(err.message)}</div>
      </div>
    </div>`;
  }
}

function showNewAgentModal() {
  const modal = document.createElement('div');
  modal.className = 'modal-backdrop';
  modal.innerHTML = `
    <div class="modal" onclick="event.stopPropagation()">
      <div class="modal-title">New local agent</div>
      <div style="font-size:12px;color:var(--text-secondary);line-height:1.5;margin-bottom:14px">
        Create a local registry entry. Webhook dispatch targets must be env var names, not raw URLs or tokens.
      </div>
      ${field('agent-id', 'Agent ID', 'example-research-agent')}
      ${field('agent-name', 'Name', 'Example Research Agent')}
      ${field('agent-type', 'Type', 'research')}
      ${field('agent-skills', 'Skills', 'research, synthesis')}
      <label class="form-label" style="display:flex;gap:8px;align-items:center;margin:10px 0 12px">
        <input id="agent-dispatch-enabled" type="checkbox">
        Enable webhook dispatch
      </label>
      ${field('agent-dispatch-target', 'Webhook URL env var', 'MY_AGENT_WEBHOOK_URL')}
      <div id="agent-create-error" style="font-size:12px;color:var(--color-red);margin-top:10px" hidden></div>
      <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:16px">
        <button class="btn btn-ghost" id="agent-cancel" type="button">Cancel</button>
        <button class="btn btn-primary" id="agent-create" type="button">Create agent</button>
      </div>
    </div>`;
  modal.onclick = () => modal.remove();
  document.body.appendChild(modal);

  const dispatchEnabled = document.getElementById('agent-dispatch-enabled');
  const dispatchTarget = document.getElementById('agent-dispatch-target');
  const errorEl = document.getElementById('agent-create-error');
  const createBtn = document.getElementById('agent-create');
  dispatchTarget.disabled = true;
  dispatchEnabled.onchange = () => { dispatchTarget.disabled = !dispatchEnabled.checked; };
  document.getElementById('agent-cancel').onclick = () => modal.remove();
  document.getElementById('agent-id').focus();

  createBtn.onclick = async () => {
    errorEl.hidden = true;
    createBtn.disabled = true;
    createBtn.textContent = 'Creating…';
    try {
      const id = value('agent-id');
      const target = value('agent-dispatch-target');
      const body = {
        id,
        name: value('agent-name'),
        type: value('agent-type') || 'general',
        skills: value('agent-skills').split(',').map(skill => skill.trim()).filter(Boolean),
      };
      if (dispatchEnabled.checked) {
        body.dispatch_enabled = true;
        body.dispatch_transport = 'webhook';
        body.dispatch_target = target;
        body.dispatch_config = { url_env: target };
      }
      await post('/api/agents', body);
      modal.remove();
      await renderTeam();
    } catch (err) {
      errorEl.textContent = err.message;
      errorEl.hidden = false;
    } finally {
      createBtn.disabled = false;
      createBtn.textContent = 'Create agent';
    }
  };
}

function summarizeAgents(agents) {
  return agents.reduce((acc, agent) => {
    acc[agent.status] = (acc[agent.status] || 0) + 1;
    if (agent.dispatch_enabled) acc.dispatchReady += 1;
    return acc;
  }, { idle: 0, running: 0, dispatchReady: 0 });
}

function agentCard(agent) {
  const health = STATUS_HEALTH[agent.status] || 'offline';
  const skills = Array.isArray(agent.skills) ? agent.skills.slice(0, 6) : [];
  const dispatch = dispatchSummary(agent);

  return `
<div class="card card-kpi" style="border-radius:var(--radius-card)">

  <div style="display:flex;align-items:flex-start;gap:14px;margin-bottom:18px">
    <div style="width:52px;height:52px;border-radius:50%;background:color-mix(in srgb,var(--accent) 12%,var(--bg-surface));display:flex;align-items:center;justify-content:center;font-size:24px;flex-shrink:0">
      ${escapeHtml(agentEmoji(agent))}
    </div>
    <div style="min-width:0">
      <div style="font-size:20px;font-weight:700;color:var(--text-primary)">${escapeHtml(agent.name || agent.id)}</div>
      <div style="font-size:12px;color:var(--text-secondary);margin-top:2px;word-break:break-word">${escapeHtml(agent.id)} · ${escapeHtml(agent.type || 'agent')}</div>
    </div>
    <div style="margin-left:auto;display:flex;align-items:center;gap:6px;font-size:12px;color:var(--text-secondary)">
      <span class="status-dot ${health}"></span>
      ${escapeHtml(agent.status || 'unknown')}
    </div>
  </div>

  <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:16px">
    ${metaField('Current task', agent.current_task_id || '—')}
    ${metaField('Current run', agent.current_run_id || '—')}
    ${metaField('Quality', score(agent.quality_score))}
    ${metaField('Reliability', score(agent.reliability_score))}
  </div>

  <div style="font-size:12px;color:var(--text-secondary);padding:12px;border:1px solid var(--border);border-radius:var(--radius);margin-bottom:16px">
    <div style="display:flex;justify-content:space-between;gap:12px;margin-bottom:6px">
      <strong style="color:var(--text-primary)">Dispatch</strong>
      <span class="badge badge-${dispatch.badge}">${escapeHtml(dispatch.label)}</span>
    </div>
    <div>${escapeHtml(dispatch.detail)}</div>
  </div>

  <div style="display:flex;gap:6px;flex-wrap:wrap">
    ${skills.length ? skills.map(skill => `<span class="badge badge-medium" style="font-size:10px">${escapeHtml(skill)}</span>`).join('') : '<span style="font-size:12px;color:var(--text-secondary)">No skills listed</span>'}
  </div>

</div>`;
}

function dispatchSummary(agent) {
  if (!agent.dispatch_enabled) {
    return { badge: 'not_configured', label: 'manual', detail: 'Manual or unconfigured agent; BATON will not fake a running state.' };
  }
  const transport = agent.dispatch_transport || 'manual';
  if (transport === 'webhook') {
    const config = agent.dispatch_config || {};
    const target = agent.dispatch_target || config.url_env || '';
    const targetType = /^[A-Z0-9_]+$/.test(target) ? 'environment variable' : (target.includes('localhost') || target.includes('127.0.0.1') ? 'local URL' : 'configured target');
    return { badge: 'queued', label: 'webhook', detail: `Webhook dispatch enabled via ${targetType}; secret values are not shown.` };
  }
  return { badge: 'queued', label: transport, detail: `${transport} dispatch enabled; target details are intentionally summarized.` };
}

function agentEmoji(agent) {
  const type = String(agent.type || '').toLowerCase();
  if (type.includes('code')) return '⌘';
  if (type.includes('research')) return '🔎';
  if (type.includes('copy')) return '✍️';
  if (type.includes('design')) return '◇';
  if (type.includes('strategy')) return '♟';
  if (type.includes('eval')) return '✓';
  if (type.includes('ops')) return '⚙';
  return '◌';
}

function score(value) {
  if (value == null || value === '') return '—';
  const n = Number(value);
  return Number.isFinite(n) ? n.toFixed(2) : String(value);
}

function summaryPill(label, value) {
  return `<div class="card" style="padding:10px 12px;min-width:94px">
    <div style="font-size:10px;text-transform:uppercase;letter-spacing:0.08em;color:var(--text-secondary)">${escapeHtml(label)}</div>
    <div style="font-family:var(--font-instrument);font-size:20px;font-weight:700;color:var(--text-primary)">${escapeHtml(value)}</div>
  </div>`;
}

function metaField(label, value) {
  return `<div>
    <div style="font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:0.1em;color:var(--text-secondary);margin-bottom:4px">${escapeHtml(label)}</div>
    <div style="font-size:13px;color:var(--text-primary);word-break:break-word">${escapeHtml(value)}</div>
  </div>`;
}

function field(id, label, placeholder) {
  return `<label class="form-label" for="${escapeAttr(id)}">${escapeHtml(label)}</label>
    <input class="form-input" id="${escapeAttr(id)}" placeholder="${escapeAttr(placeholder)}">`;
}

function value(id) {
  return document.getElementById(id).value.trim();
}

function emptyState() {
  return `<div class="card" style="grid-column:1/-1;text-align:center;padding:32px;color:var(--text-secondary)">
    No agents found. Import a private local profile or restart BATON to seed generic demo agents.
  </div>`;
}
