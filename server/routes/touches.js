'use strict';
const express = require('express');
const crypto = require('crypto');
const db = require('../db');
const { id, stringifyJson } = require('../lib/flow/utils');
const { sqliteDateTimeAfterMs, toSqliteDateTime } = require('../lib/flow/time');
const { isActionAllowed } = require('../lib/flow/actions');
const { rebuildTouches, parseTouch, rankOpenTouches } = require('../lib/flow/rebuild');
const { markDomainTouched } = require('../lib/flow/portfolio');
const { dispatchRun } = require('../lib/dispatch');
const { transitionRun } = require('../lib/runs/state-machine');

const router = express.Router();

router.get('/', (req, res) => {
  try {
    let sql = `SELECT * FROM baton_touches WHERE 1=1`;
    const params = [];
    if (req.query.status) { sql += ' AND status = ?'; params.push(req.query.status); }
    if (req.query.type) { sql += ' AND type = ?'; params.push(req.query.type); }
    if (req.query.domain) { sql += ' AND domain = ?'; params.push(req.query.domain); }
    if (req.query.project_key) { sql += ' AND project_key = ?'; params.push(req.query.project_key); }
    if (req.query.include_archived !== 'true') sql += ` AND status NOT IN ('archived', 'resolved')`;
    sql += ' ORDER BY score DESC, created_at ASC LIMIT ?';
    params.push(Number(req.query.limit || 50));
    res.json(db.prepare(sql).all(...params).map(parseTouch));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/rebuild', (_req, res) => {
  try { res.json(rebuildTouches(db)); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

router.patch('/:id/action', async (req, res) => {
  try {
    const touch = db.prepare('SELECT * FROM baton_touches WHERE id = ?').get(req.params.id);
    if (!touch) return res.status(404).json({ error: 'Not found' });
    const action = req.body.action;
    if (!action) return res.status(400).json({ error: 'action is required' });
    if (!isActionAllowed(touch.type, action)) {
      return res.status(400).json({
        error: `action ${action} is not allowed for touch type ${touch.type}`,
        touch_type: touch.type,
        action,
      });
    }

    if (['delegate', 'assign', 'send_to_evaluator'].includes(action)) {
      const runId = createDispatchRun(touch, req.body, action);
      const result = await dispatchRun({ db, runId, intent: action === 'send_to_evaluator' ? 'evaluate' : 'orchestrate', instructions: instructionsFromBody(req.body) });
      const updatedTouch = parseTouch(db.prepare('SELECT * FROM baton_touches WHERE id = ?').get(touch.id));
      const updatedTask = touch.task_id ? db.prepare('SELECT * FROM tasks WHERE id = ?').get(touch.task_id) : null;
      return res.json({ touch: updatedTouch, task: updatedTask, run: result.run, dispatch_status: result.dispatch_status, message: result.message, error: result.error || null });
    }

    const tx = db.transaction(() => {
      const eventId = id('event');
      let touchStatus = touch.status;
      let taskStatus = null;
      let message = 'Touch updated.';
      let snoozedUntil = null;
      let resolvedAt = null;
      let dispatchStatus = null;

      if (action === 'accept') {
        touchStatus = 'resolved';
        taskStatus = req.body.update_task === false ? null : 'done';
        resolvedAt = toSqliteDateTime();
        completeLinkedRun(touch);
        message = taskStatus ? 'Accepted and marked task done.' : 'Accepted.';
      } else if (action === 'refine') {
        touchStatus = 'passed';
        taskStatus = req.body.update_task === false ? null : 'waiting';
        message = 'Feedback captured and task moved back for refinement.';
      } else if (action === 'answer') {
        touchStatus = 'passed';
        taskStatus = 'ready';
        message = 'Answer captured; task is ready to pass.';
      } else if (action === 'snooze') {
        touchStatus = 'snoozed';
        snoozedUntil = normalizeSnooze(req.body.until) || defaultSnooze();
        message = `Snoozed until ${snoozedUntil}.`;
      } else if (action === 'archive') {
        touchStatus = 'archived';
        message = 'Archived touch.';
      } else if (action === 'process') {
        touchStatus = 'resolved';
        taskStatus = req.body.task_status || 'ready';
        resolvedAt = toSqliteDateTime();
        message = 'Processed capture and made task ready.';
      } else if (action === 'inspect') {
        touchStatus = 'active';
        message = 'Marked for inspection.';
      } else if (action === 'escalate') {
        db.prepare(`
          UPDATE baton_touches
          SET manual_priority_boost = MIN(1.0, COALESCE(manual_priority_boost, 0) + 0.2),
              score = MIN(100, COALESCE(score, 0) + 4),
              updated_at = datetime('now')
          WHERE id = ?
        `).run(touch.id);
        message = 'Escalated touch priority.';
      }

      db.prepare(`
        UPDATE baton_touches
        SET status = ?, last_touched_at = datetime('now'), snoozed_until = ?, resolved_at = ?, updated_at = datetime('now')
        WHERE id = ?
      `).run(touchStatus, snoozedUntil, resolvedAt, touch.id);

      if (taskStatus && touch.task_id) {
        db.prepare(`UPDATE tasks SET status = ?, updated_at = datetime('now') WHERE id = ?`).run(taskStatus, touch.task_id);
      }

      db.prepare(`INSERT INTO touch_events (id, touch_id, event_type, actor, payload) VALUES (?, ?, ?, 'human', ?)`).run(
        eventId,
        touch.id,
        eventName(action),
        stringifyJson({ feedback: req.body.feedback || '', instructions: req.body.instructions || '', reason: req.body.reason || '', dispatch_status: dispatchStatus })
      );

      if (['accept', 'process', 'archive', 'answer', 'refine'].includes(action)) markDomainTouched(db, touch.domain);
      if (taskStatus || ['archive', 'snooze', 'accept', 'process'].includes(action)) rebuildTouches(db);
      else rankOpenTouches(db);
      const updatedTouch = parseTouch(db.prepare('SELECT * FROM baton_touches WHERE id = ?').get(touch.id));
      const updatedTask = touch.task_id ? db.prepare('SELECT * FROM tasks WHERE id = ?').get(touch.task_id) : null;
      return { touch: updatedTouch, task: updatedTask, run: null, event_id: eventId, dispatch_status: dispatchStatus, message };
    });

    res.json(tx());
  } catch (err) { res.status(500).json({ error: err.message }); }
});

function createDispatchRun(touch, body, action) {
  const task = touch.task_id ? db.prepare('SELECT * FROM tasks WHERE id = ?').get(touch.task_id) : null;
  const agent = resolveAgent(touch, body, action);
  const runId = id('run');
  const existing = db.prepare(`
    SELECT * FROM runs
    WHERE touch_id = ? AND status IN ('pending_dispatch', 'dispatched', 'running', 'blocked', 'review_ready')
    ORDER BY created_at DESC LIMIT 1
  `).get(touch.id);
  if (existing) return existing.id;
  const agentName = agent?.name || body.agent_name || 'manual';
  const workerType = agent?.type || null;
  const transport = agent?.dispatch_transport || 'manual';
  const target = agent?.dispatch_target || null;
  const stateVersion = Number(touch.state_version || 0) + 1;
  const idempotencyKey = crypto.createHash('sha256').update([touch.id, stateVersion, action, agent?.id || 'manual'].join(':')).digest('hex');
  const tx = db.transaction(() => {
    const claimed = db.prepare(`
      UPDATE baton_touches
      SET status = 'dispatching', state_version = state_version + 1, updated_at = datetime('now')
      WHERE id = ? AND status IN ('pending', 'active')
    `).run(touch.id);
    if (claimed.changes !== 1) {
      const activeRun = db.prepare(`
        SELECT id FROM runs
        WHERE touch_id = ? AND status IN ('pending_dispatch', 'dispatched', 'running', 'blocked', 'review_ready')
        ORDER BY created_at DESC LIMIT 1
      `).get(touch.id);
      if (activeRun) return activeRun.id;
      throw new Error(`Touch ${touch.id} is not dispatchable from status ${touch.status}.`);
    }
    db.prepare(`
      INSERT INTO runs (
        id, agent_name, worker_type, status, task_id, touch_id, agent_id,
        dispatch_status, dispatch_transport, dispatch_target, idempotency_key, steps, logs, created_at
      ) VALUES (?, ?, ?, 'pending_dispatch', ?, ?, ?, 'queued', ?, ?, ?, '[]', '[]', datetime('now'))
    `).run(runId, agentName, workerType, task?.id || null, touch.id, agent?.id || null, transport, target, idempotencyKey);
    db.prepare(`INSERT INTO touch_events (id, touch_id, event_type, actor, payload) VALUES (?, ?, ?, 'human', ?)`).run(
      id('event'),
      touch.id,
      eventName(action),
      stringifyJson({ action, run_id: runId, agent_id: agent?.id || null, instructions: body.instructions || body.feedback || '' })
    );
    markDomainTouched(db, touch.domain);
    return runId;
  });
  return tx();
}

function resolveAgent(touch, body, action) {
  const ids = [touch.agent_id, body.agent_id].filter(Boolean);
  if (action === 'send_to_evaluator') ids.push('evaluator-agent', 'spectre');
  if (touch.task_id) {
    const task = db.prepare('SELECT owner FROM tasks WHERE id = ?').get(touch.task_id);
    if (task?.owner) ids.push(task.owner);
  }
  ids.push('spectre');
  for (const agentId of ids) {
    const agent = db.prepare('SELECT * FROM agents WHERE id = ?').get(agentId);
    if (action === 'send_to_evaluator' && agent && !isDispatchCapable(agent)) continue;
    if (agent) return agent;
  }
  return db.prepare(`SELECT * FROM agents WHERE status = 'idle' AND dispatch_enabled = 1 ORDER BY name LIMIT 1`).get() || null;
}

function isDispatchCapable(agent) {
  return Number(agent.dispatch_enabled || 0) === 1 && agent.dispatch_transport && agent.dispatch_transport !== 'manual';
}

function instructionsFromBody(body) {
  const text = body.instructions || body.feedback || '';
  if (!text) return [];
  return Array.isArray(text) ? text.map(String) : [String(text)];
}

function completeLinkedRun(touch) {
  let runId = touch.run_id;
  if (!runId && touch.review_packet_id) {
    const packet = db.prepare('SELECT run_id FROM review_packets WHERE id = ?').get(touch.review_packet_id);
    runId = packet?.run_id || null;
  }
  if (!runId) return;
  const run = db.prepare('SELECT agent_id FROM runs WHERE id = ?').get(runId);
  const transitioned = transitionRun({ db, runId, event: 'completed', toStatus: 'completed', actor: 'operator', payload: { touch_id: touch.id } });
  if (!transitioned.ok && transitioned.code !== 'terminal_state') throw new Error(transitioned.error || transitioned.code || 'Run transition failed.');
  if (run?.agent_id) {
    db.prepare(`UPDATE agents SET status = 'idle', current_task_id = NULL, current_run_id = NULL, updated_at = datetime('now') WHERE id = ? AND current_run_id = ?`).run(run.agent_id, runId);
  }
}

function defaultSnooze() {
  return sqliteDateTimeAfterMs(60 * 60 * 1000);
}

function normalizeSnooze(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return toSqliteDateTime(date);
}

function eventName(action) {
  return ({ accept: 'accepted', refine: 'refined', delegate: 'delegated', assign: 'delegated', answer: 'resolved', send_to_evaluator: 'delegated', snooze: 'snoozed', archive: 'archived', process: 'resolved', inspect: 'opened', escalate: 'escalated' })[action] || action;
}

module.exports = router;
