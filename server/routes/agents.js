'use strict';
const express = require('express');
const db = require('../db');
const { parseJson, stringifyJson } = require('../lib/flow/utils');
const { rebuildTouches } = require('../lib/flow/rebuild');

const router = express.Router();
const VALID_STATUSES = ['idle', 'running', 'blocked', 'failed', 'reviewing', 'paused', 'offline'];
const ALLOWED = ['name', 'type', 'status', 'skills', 'permissions', 'current_task_id', 'current_run_id', 'cost_profile', 'quality_score', 'reliability_score', 'last_activity_at'];

router.get('/', (req, res) => {
  try {
    let sql = 'SELECT * FROM agents WHERE 1=1';
    const params = [];
    if (req.query.status) { sql += ' AND status = ?'; params.push(req.query.status); }
    if (req.query.type) { sql += ' AND type = ?'; params.push(req.query.type); }
    sql += ' ORDER BY CASE status WHEN \'idle\' THEN 0 WHEN \'running\' THEN 1 WHEN \'blocked\' THEN 2 ELSE 3 END, name ASC';
    res.json(db.prepare(sql).all(...params).map(parseAgent));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/:id', (req, res) => {
  try {
    const agent = db.prepare('SELECT * FROM agents WHERE id = ?').get(req.params.id);
    if (!agent) return res.status(404).json({ error: 'Not found' });
    res.json(parseAgent(agent));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.patch('/:id', (req, res) => {
  try {
    const agent = db.prepare('SELECT * FROM agents WHERE id = ?').get(req.params.id);
    if (!agent) return res.status(404).json({ error: 'Not found' });
    if (req.body.status && !VALID_STATUSES.includes(req.body.status)) return res.status(400).json({ error: `invalid status: ${req.body.status}` });

    const updates = [];
    const vals = [];
    for (const key of ALLOWED) {
      if (!(key in req.body)) continue;
      updates.push(`${key} = ?`);
      vals.push(['skills', 'permissions', 'cost_profile'].includes(key) ? stringifyJson(req.body[key]) : req.body[key]);
    }
    if (!updates.length) return res.status(400).json({ error: 'No valid fields to update' });
    updates.push('updated_at = datetime(\'now\')');
    vals.push(req.params.id);
    db.prepare(`UPDATE agents SET ${updates.join(', ')} WHERE id = ?`).run(...vals);
    rebuildTouches(db);
    res.json(parseAgent(db.prepare('SELECT * FROM agents WHERE id = ?').get(req.params.id)));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

function parseAgent(row) {
  return {
    ...row,
    skills: parseJson(row.skills, []),
    permissions: parseJson(row.permissions, {}),
    cost_profile: parseJson(row.cost_profile, {}),
  };
}

module.exports = router;
