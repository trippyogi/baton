'use strict';
const express = require('express');
const db = require('../db');
const { id, stringifyJson } = require('../lib/flow/utils');
const { sqliteDateTimeAfterMs, toSqliteDateTime } = require('../lib/flow/time');
const { isActionAllowed } = require('../lib/flow/actions');
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
    if (!isActionAllowed(touch.type, action)) {
      return res.status(400).json({
        error: `action ${action} is not allowed for touch type ${touch.type}`,
        touch_type: touch.type,
        action,
      });
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
        message = taskStatus ? 'Accepted and marked task done.' : 'Accepted.';
      } else if (action === 'refine') {
        touchStatus = 'passed';
        taskStatus = req.body.update_task === false ? null : 'waiting';
        message = 'Feedback captured and task moved back for refinement.';
      } else if (action === 'delegate' || action === 'assign') {
        // Honest boundary: no worker dispatcher is configured yet, so do not claim
        // the task is airborne or the agent is running.
        touchStatus = 'active';
        dispatchStatus = 'not_configured';
        message = 'Prepared for delegation. No worker dispatch configured.';
      } else if (action === 'answer') {
        touchStatus = 'passed';
        taskStatus = 'ready';
        message = 'Answer captured; task is ready to pass.';
      } else if (action === 'send_to_evaluator') {
        touchStatus = 'active';
        dispatchStatus = 'not_configured';
        message = 'Prepared for evaluator/refiner. No worker dispatch configured.';
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
        db.prepare(`UPDATE baton_touches SET urgency_score = MIN(1.0, urgency_score + 0.2), updated_at = datetime('now') WHERE id = ?`).run(touch.id);
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

      if (['accept', 'process', 'archive'].includes(action)) markDomainTouched(db, touch.domain);
      if (taskStatus || ['archive', 'snooze', 'accept', 'process'].includes(action)) rebuildTouches(db);
      else rankOpenTouches(db);
      const updatedTouch = parseTouch(db.prepare('SELECT * FROM baton_touches WHERE id = ?').get(touch.id));
      const updatedTask = touch.task_id ? db.prepare('SELECT * FROM tasks WHERE id = ?').get(touch.task_id) : null;
      return { touch: updatedTouch, task: updatedTask, run: null, event_id: eventId, dispatch_status: dispatchStatus, message };
    });

    res.json(tx());
  } catch (err) { res.status(500).json({ error: err.message }); }
});

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
