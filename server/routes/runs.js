'use strict';
const express = require('express');
const db = require('../db');
const { randomUUID } = require('crypto');
const { parseJson, stringifyJson } = require('../lib/flow/utils');

const router = express.Router();

function parseRun(row) {
  return {
    ...row,
    steps: parseJson(row.steps, []),
    logs: parseJson(row.logs, []),
  };
}

router.get('/stream', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
  });

  res.write(`event: snapshot\ndata: ${JSON.stringify({ ok: true })}\n\n`);
  const timer = setInterval(() => {
    res.write(`event: heartbeat\ndata: ${JSON.stringify({ at: new Date().toISOString() })}\n\n`);
  }, 30000);
  req.on('close', () => clearInterval(timer));
});

router.get('/', (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit || 50), 200);
    let sql = 'SELECT * FROM runs WHERE 1=1';
    const params = [];

    if (req.query.worker_type) {
      sql += ' AND worker_type = ?';
      params.push(req.query.worker_type);
    }
    if (req.query.status) {
      sql += ' AND status = ?';
      params.push(req.query.status);
    }

    const total = db.prepare(`SELECT COUNT(*) AS n FROM (${sql})`).get(...params).n;
    sql += ' ORDER BY created_at DESC LIMIT ?';
    params.push(limit);
    const runs = db.prepare(sql).all(...params).map(parseRun);
    res.json({ runs, total });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/:id', (req, res) => {
  try {
    const run = db.prepare('SELECT * FROM runs WHERE id = ?').get(req.params.id);
    if (!run) return res.status(404).json({ error: 'Not found' });
    res.json(parseRun(run));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/', (req, res) => {
  const { agent_name = 'agent', worker_type = null, status = 'pending', cost = 0, tokens = 0, started_at = null, steps = [], logs = [] } = req.body;
  const id = randomUUID();

  try {
    db.prepare(`
      INSERT INTO runs (id, agent_name, worker_type, status, cost, tokens, started_at, steps, logs)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, agent_name, worker_type, status, cost, tokens, started_at, stringifyJson(steps), stringifyJson(logs));
    res.status(201).json(parseRun(db.prepare('SELECT * FROM runs WHERE id = ?').get(id)));
  } catch (error) {
    res.status(500).json({ error: 'Insertion failed: ' + error.message });
  }
});

router.patch('/:id', (req, res) => {
  const { id } = req.params;
  const { status, ended_at, cost, tokens, logs, steps, output_path, output_preview, fix_attempts } = req.body;

  const fields = [];
  const values = [];

  if (status         !== undefined) { fields.push('status = ?');          values.push(status); }
  if (ended_at       !== undefined) { fields.push('ended_at = ?');         values.push(ended_at); }
  if (cost           !== undefined) { fields.push('cost = ?');             values.push(cost); }
  if (tokens         !== undefined) { fields.push('tokens = ?');           values.push(tokens); }
  if (logs           !== undefined) { fields.push('logs = ?');             values.push(typeof logs === 'string' ? logs : stringifyJson(logs)); }
  if (steps          !== undefined) { fields.push('steps = ?');            values.push(typeof steps === 'string' ? steps : stringifyJson(steps)); }
  if (output_path    !== undefined) { fields.push('output_path = ?');      values.push(output_path); }
  if (output_preview !== undefined) { fields.push('output_preview = ?');   values.push(output_preview); }
  if (fix_attempts   !== undefined) { fields.push('fix_attempts = ?');     values.push(fix_attempts); }

  if (fields.length === 0) return res.status(400).json({ error: 'No fields to update' });

  values.push(id);
  const result = db.prepare(`UPDATE runs SET ${fields.join(', ')} WHERE id = ?`).run(...values);

  if (result.changes === 0) return res.status(404).json({ error: 'Not found' });
  res.status(200).json(parseRun(db.prepare('SELECT * FROM runs WHERE id = ?').get(id)));
});

module.exports = router;
