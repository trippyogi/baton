'use strict';
const express = require('express');
const db      = require('../db');
const router  = express.Router();
const { randomUUID } = require('crypto');

router.get('/', (req, res) => {
  try {
    const includeResolved = req.query.resolved === 'true';
    const sql = includeResolved
      ? 'SELECT * FROM alerts ORDER BY CASE severity WHEN \'critical\' THEN 0 WHEN \'warning\' THEN 1 ELSE 2 END, created_at DESC'
      : 'SELECT * FROM alerts WHERE resolved_at IS NULL ORDER BY CASE severity WHEN \'critical\' THEN 0 WHEN \'warning\' THEN 1 ELSE 2 END, created_at DESC';
    res.json(db.prepare(sql).all());
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/', (req, res) => {
  try {
    const { type = 'info', severity = 'info', message } = req.body;
    if (!message) return res.status(400).json({ error: 'message required' });
    const id = randomUUID();
    db.prepare('INSERT INTO alerts (id,type,severity,message) VALUES (?,?,?,?)').run(id, type, severity, message);
    res.status(201).json(db.prepare('SELECT * FROM alerts WHERE id = ?').get(id));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.patch('/:id/resolve', (req, res) => {
  try {
    const alert = db.prepare('SELECT * FROM alerts WHERE id = ?').get(req.params.id);
    if (!alert) return res.status(404).json({ error: 'Not found' });
    db.prepare('UPDATE alerts SET resolved_at = datetime(\'now\') WHERE id = ?').run(req.params.id);
    res.json(db.prepare('SELECT * FROM alerts WHERE id = ?').get(req.params.id));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
