'use strict';
const express = require('express');
const db = require('../db');
const { id, stringifyJson, parseJson } = require('../lib/flow/utils');
const { rebuildTouches, parseTouch, rankOpenTouches } = require('../lib/flow/rebuild');
const { markDomainTouched } = require('../lib/flow/portfolio');

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

router.patch('/:id/action', (req, res) => {
  try {
    const touch = db.prepare('SELECT * FROM baton_touches WHERE id = ?').get(req.params.id);
    if (!touch) return res.status(404).json({ error: 'Not found' });
    const action = req.body.action;
    if (!action) return res.status(400).json({ error: 'action is required' });

    const tx = db.transaction(() => {
      const eventId = id('event');
      let touchStatus = touch.status;
      let taskStatus = null;
      let message = 'Touch updated.';
      let snoozedUntil = null;
      let resolvedAt = null;

      if (action === 'accept') {
        touchStatus = 'resolved';
        taskStatus = req.body.update_task === false ? null : 'done';
        resolvedAt = new Date().toISOString();
        message = taskStatus ? 'Accepted and marked task done.' : 'Accepted.';
      } else if (action === 'refine') {
        touchStatus = 'passed';
        taskStatus = req.body.update_task === false ? null : 'waiting';
        message = 'Feedback captured and task moved back for refinement.';
      } else if (action === 'delegate' || action === 'assign') {
        touchStatus = 'passed';
        taskStatus = 'in_progress';
        if (touch.agent_id) {
          db.prepare(`
            UPDATE agents
            SET status = 'running', current_task_id = ?, last_activity_at = datetime('now'), updated_at = datetime('now')
            WHERE id = ?
          `).run(touch.task_id, touch.agent_id);
        }
        message = touch.agent_id ? 'Assigned agent and moved task airborne.' : 'Delegated and moved task airborne.';
      } else if (action === 'answer') {
        touchStatus = 'passed';
        taskStatus = 'ready';
        message = 'Answer captured; task is ready to pass.';
      } else if (action === 'send_to_evaluator') {
        touchStatus = 'passed';
        taskStatus = 'in_progress';
        message = 'Sent to evaluator/refiner.';
      } else if (action === 'snooze') {
        touchStatus = 'snoozed';
        snoozedUntil = req.body.until || defaultSnooze();
        message = `Snoozed until ${snoozedUntil}.`;
      } else if (action === 'archive') {
        touchStatus = 'archived';
        message = 'Archived touch.';
      } else if (action === 'process') {
        touchStatus = 'resolved';
        taskStatus = req.body.task_status || 'ready';
        resolvedAt = new Date().toISOString();
        message = 'Processed capture and made task ready.';
      } else if (action === 'inspect') {
        touchStatus = 'active';
        message = 'Marked for inspection.';
      } else if (action === 'escalate') {
        db.prepare(`UPDATE baton_touches SET urgency_score = MIN(1.0, urgency_score + 0.2), updated_at = datetime('now') WHERE id = ?`).run(touch.id);
        message = 'Escalated touch priority.';
      } else {
        return { error: `unsupported action: ${action}` };
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
        stringifyJson({ feedback: req.body.feedback || '', instructions: req.body.instructions || '', reason: req.body.reason || '' })
      );

      if (['accept', 'process', 'archive'].includes(action)) markDomainTouched(db, touch.domain);
      rankOpenTouches(db);
      const updatedTouch = parseTouch(db.prepare('SELECT * FROM baton_touches WHERE id = ?').get(touch.id));
      const updatedTask = touch.task_id ? db.prepare('SELECT * FROM tasks WHERE id = ?').get(touch.task_id) : null;
      return { touch: updatedTouch, task: updatedTask, event_id: eventId, message };
    });

    const result = tx();
    if (result.error) return res.status(400).json(result);
    res.json(result);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

function defaultSnooze() {
  return new Date(Date.now() + 24 * 3600 * 1000).toISOString();
}

function eventName(action) {
  return ({ accept: 'accepted', refine: 'refined', delegate: 'delegated', assign: 'delegated', answer: 'resolved', send_to_evaluator: 'delegated', snooze: 'snoozed', archive: 'archived', process: 'resolved', inspect: 'opened', escalate: 'escalated' })[action] || action;
}

module.exports = router;
