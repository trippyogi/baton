'use strict';
const express = require('express');
const db = require('../db');
const { id } = require('../lib/flow/utils');
const { loadSettings } = require('../lib/flow/rebuild');
const { buildDispatchEnvelope } = require('../lib/dispatch/envelope');
const { resolveDispatch, dispatchRun, publicBaseUrl } = require('../lib/dispatch');

const router = express.Router();

router.post('/test', async (req, res) => {
  try {
    const agentId = req.body.agent_id || 'spectre';
    const agent = db.prepare('SELECT * FROM agents WHERE id = ?').get(agentId);
    if (!agent) return res.status(404).json({ error: `unknown agent_id: ${agentId}` });
    const task = req.body.task_id
      ? db.prepare('SELECT * FROM tasks WHERE id = ?').get(req.body.task_id)
      : { id: 'dry_task', title: req.body.title || 'Evaluate MetaTravelers campaign launch sequence', description: req.body.description || '', priority: 'high', domain: 'revenue', project_key: 'metatravelers', risk_level: 'medium', autonomy_level: 3 };
    const touch = req.body.touch_id
      ? db.prepare('SELECT * FROM baton_touches WHERE id = ?').get(req.body.touch_id)
      : { id: 'dry_touch', title: task.title, description: task.description, domain: task.domain, project_key: task.project_key, risk_level: task.risk_level, autonomy_level: task.autonomy_level };
    const run = { id: req.body.run_id || 'dry_run', task_id: task.id, touch_id: touch.id, agent_id: agent.id };
    const envelope = buildDispatchEnvelope({ run, task, touch, agent, settings: loadSettings(db), baseUrl: publicBaseUrl(), intent: req.body.intent || 'orchestrate' });
    const dispatch = resolveDispatch(agent);
    if (req.body.dry_run !== false) return res.json({ dry_run: true, envelope, dispatch: safeDispatch(dispatch) });

    if (!req.body.task_id || !req.body.touch_id) return res.status(400).json({ error: 'live test requires task_id and touch_id' });
    const runId = id('run');
    db.prepare(`
      INSERT INTO runs (id, agent_name, worker_type, status, task_id, touch_id, agent_id, dispatch_status, dispatch_transport, dispatch_target, steps, logs)
      VALUES (?, ?, ?, 'pending_dispatch', ?, ?, ?, 'queued', ?, ?, '[]', '[]')
    `).run(runId, agent.name, agent.type, task.id, touch.id, agent.id, dispatch.transport, dispatch.target || null);
    const result = await dispatchRun({ db, runId, intent: req.body.intent || 'orchestrate' });
    res.status(201).json(result);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

function safeDispatch(dispatch) {
  return {
    enabled: dispatch.enabled,
    transport: dispatch.transport,
    target: dispatch.target,
    url_configured: Boolean(dispatch.url),
    token_configured: Boolean(dispatch.token),
    timeout_ms: dispatch.timeoutMs,
  };
}

module.exports = router;
