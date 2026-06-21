'use strict';
const { stringifyJson, parseJson } = require('../flow/utils');
const { loadSettings, rebuildTouches } = require('../flow/rebuild');
const { buildDispatchEnvelope } = require('./envelope');
const { sendWebhook } = require('./transports/webhook');
const { sendManual } = require('./transports/manual');
const { transitionRun, isActive, isTerminal } = require('../runs/state-machine');

function publicBaseUrl() {
  return process.env.BATON_PUBLIC_BASE_URL || `http://127.0.0.1:${process.env.VMC_PORT || process.env.PORT || 4200}`;
}

function parseAgent(agent) {
  return {
    ...agent,
    skills: parseJson(agent.skills, []),
    permissions: parseJson(agent.permissions, {}),
    dispatch_config: parseJson(agent.dispatch_config, {}),
  };
}

function resolveDispatch(agent) {
  const config = typeof agent.dispatch_config === 'string' ? parseJson(agent.dispatch_config, {}) : (agent.dispatch_config || {});
  const transport = config.transport || agent.dispatch_transport || 'manual';
  const urlEnv = config.url_env || null;
  const tokenEnv = config.token_env;
  const target = agent.dispatch_target || urlEnv || null;
  const literalUrl = target && /^https?:\/\//i.test(target) ? target : null;
  return {
    enabled: Boolean(agent.dispatch_enabled),
    transport,
    target,
    url: literalUrl || (urlEnv ? process.env[urlEnv] : (target ? process.env[target] : null)),
    token: tokenEnv ? process.env[tokenEnv] : null,
    timeoutMs: Number(config.timeout_ms || 10000),
    config,
  };
}

async function dispatchRun({ db, runId, intent = 'orchestrate', instructions = [] }) {
  const run = db.prepare('SELECT * FROM runs WHERE id = ?').get(runId);
  if (!run) throw new Error(`Unknown run: ${runId}`);
  if (['dispatched', 'running', 'blocked', 'review_ready'].includes(run.status)) {
    return { ok: true, dispatch_status: run.dispatch_status || 'accepted', run: loadRun(db, runId), envelope: parseJson(run.dispatch_payload, {}), message: 'Run already dispatched.' };
  }
  if (isTerminal(run.status)) {
    return { ok: false, dispatch_status: run.dispatch_status || run.status, run: loadRun(db, runId), envelope: parseJson(run.dispatch_payload, {}), message: `Run is already terminal: ${run.status}.` };
  }
  const task = run.task_id ? db.prepare('SELECT * FROM tasks WHERE id = ?').get(run.task_id) : null;
  const touch = run.touch_id ? db.prepare('SELECT * FROM baton_touches WHERE id = ?').get(run.touch_id) : null;
  const rawAgent = run.agent_id ? db.prepare('SELECT * FROM agents WHERE id = ?').get(run.agent_id) : null;
  const agent = rawAgent ? parseAgent(rawAgent) : null;
  const settings = loadSettings(db);
  const dispatch = agent ? resolveDispatch(agent) : { enabled: false, transport: 'manual' };
  const envelope = buildDispatchEnvelope({ db, run, task, touch, agent, settings, baseUrl: publicBaseUrl(), instructions, intent });

  db.prepare(`
    UPDATE runs
    SET dispatch_payload = ?, dispatch_transport = ?, dispatch_target = ?, dispatch_status = ?, status = ?, last_status_at = datetime('now')
    WHERE id = ?
  `).run(stringifyJson(envelope), dispatch.transport || 'manual', dispatch.target || null, dispatch.enabled ? 'queued' : 'not_configured', 'pending_dispatch', runId);

  if (!agent || !dispatch.enabled || dispatch.transport === 'manual') {
    db.prepare(`UPDATE baton_touches SET status = 'active', updated_at = datetime('now') WHERE id = ?`).run(run.touch_id);
    return { ok: false, dispatch_status: 'not_configured', run: loadRun(db, runId), envelope, message: 'Prepared for delegation. No dispatch transport configured.' };
  }

  const dispatched = transitionRun({ db, runId, event: 'dispatch_sent', toStatus: 'dispatched', actor: 'baton', payload: { transport: dispatch.transport } });
  if (!dispatched.ok) return { ok: false, dispatch_status: 'failed', run: loadRun(db, runId), envelope, error: dispatched.error || dispatched.code, message: dispatched.error || 'Dispatch transition rejected.' };
  db.prepare(`UPDATE runs SET dispatch_status = 'sent', last_status_at = datetime('now') WHERE id = ?`).run(runId);
  const result = dispatch.transport === 'webhook'
    ? await sendWebhook({ url: dispatch.url, token: dispatch.token, envelope, timeoutMs: dispatch.timeoutMs })
    : await sendManual();

  if (result.ok) {
    applyAccepted(db, { runId, taskId: run.task_id, touchId: run.touch_id, agentId: run.agent_id, externalRunId: result.ack?.external_run_id || null });
    rebuildTouches(db);
    return { ok: true, dispatch_status: 'accepted', run: loadRun(db, runId), envelope, ack: result.ack, message: `Dispatched to ${agent.name}.` };
  }

  if (result.dispatch_status === 'not_configured') {
    db.prepare(`UPDATE runs SET status = 'pending_dispatch', dispatch_status = 'not_configured', error = ?, last_status_at = datetime('now') WHERE id = ?`).run(result.error || 'Dispatch not configured.', runId);
    if (run.touch_id) db.prepare(`UPDATE baton_touches SET status = 'active', updated_at = datetime('now') WHERE id = ?`).run(run.touch_id);
    rebuildTouches(db);
    return { ok: false, dispatch_status: 'not_configured', run: loadRun(db, runId), envelope, error: result.error || 'Dispatch not configured.', message: 'Prepared for delegation. No dispatch transport configured.' };
  }

  applyFailed(db, { runId, taskId: run.task_id, touchId: run.touch_id, agentId: run.agent_id, dispatchStatus: result.dispatch_status || 'failed', error: result.error || 'Dispatch failed.' });
  rebuildTouches(db);
  return { ok: false, dispatch_status: result.dispatch_status || 'failed', run: loadRun(db, runId), envelope, error: result.error || 'Dispatch failed.', message: `Dispatch failed: ${result.error || 'unknown error'}` };
}

function applyAccepted(db, { runId, taskId, touchId, agentId, externalRunId }) {
  const tx = db.transaction(() => {
    const transition = transitionRun({ db, runId, event: 'accepted', toStatus: 'running', actor: 'agent', payload: { external_run_id: externalRunId || null } });
    if (!transition.ok && transition.code === 'terminal_state') return;
    if (!transition.ok) throw new Error(transition.error || transition.code || 'Run transition failed.');
    db.prepare(`
      UPDATE runs
      SET dispatch_status = 'accepted', external_run_id = COALESCE(?, external_run_id),
          acknowledged_at = datetime('now'), last_status_at = datetime('now'), started_at = COALESCE(started_at, datetime('now')), error = NULL
      WHERE id = ?
    `).run(externalRunId, runId);
    if (taskId) db.prepare(`UPDATE tasks SET status = 'in_progress', updated_at = datetime('now') WHERE id = ?`).run(taskId);
    if (touchId) db.prepare(`UPDATE baton_touches SET status = 'passed', run_id = ?, updated_at = datetime('now') WHERE id = ?`).run(runId, touchId);
    if (agentId) {
      const claimed = db.prepare(`
        UPDATE agents
        SET status = 'running', current_task_id = ?, current_run_id = ?, last_activity_at = datetime('now'), updated_at = datetime('now')
        WHERE id = ? AND (current_run_id IS NULL OR current_run_id = ? OR status = 'idle')
      `).run(taskId, runId, agentId, runId);
      if (claimed.changes === 0) {
        db.prepare(`UPDATE runs SET error = COALESCE(error, 'Agent already had an active run when this dispatch was ACKed.') WHERE id = ?`).run(runId);
      }
    }
  });
  tx();
}

function applyFailed(db, { runId, taskId, touchId, agentId, dispatchStatus, error }) {
  const tx = db.transaction(() => {
    const transition = transitionRun({ db, runId, event: 'failed', toStatus: 'failed', actor: 'agent', payload: { dispatch_status: dispatchStatus, error } });
    if (!transition.ok && transition.code === 'terminal_state') return;
    if (!transition.ok) throw new Error(transition.error || transition.code || 'Run transition failed.');
    db.prepare(`UPDATE runs SET dispatch_status = ?, error = ?, last_status_at = datetime('now') WHERE id = ?`).run(dispatchStatus, error, runId);
    if (taskId) db.prepare(`UPDATE tasks SET status = 'ready', updated_at = datetime('now') WHERE id = ?`).run(taskId);
    if (touchId) db.prepare(`UPDATE baton_touches SET status = 'active', updated_at = datetime('now') WHERE id = ?`).run(touchId);
    if (agentId) db.prepare(`UPDATE agents SET status = 'idle', current_task_id = NULL, current_run_id = NULL, updated_at = datetime('now') WHERE id = ? AND current_run_id = ?`).run(agentId, runId);
  });
  tx();
}

function loadRun(db, runId) {
  const row = db.prepare('SELECT * FROM runs WHERE id = ?').get(runId);
  return row ? { ...row, dispatch_payload: parseJson(row.dispatch_payload, {}) } : null;
}

module.exports = { dispatchRun, applyAccepted, applyFailed, resolveDispatch, publicBaseUrl, isActive, isTerminal };
