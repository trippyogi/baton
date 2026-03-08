'use strict';
const express     = require('express');
const db          = require('../db');
const requireAuth = require('../middleware/auth');
const { randomUUID } = require('crypto');

const router = express.Router();

const VALID_STATUSES = ['pending', 'done', 'dismissed'];
const VALID_USERS    = ['jeremy', 'marko'];

// All routes protected
router.use(requireAuth);

// ── POST /api/shared-requests ─────────────────────────────────────────────────
router.post('/', (req, res) => {
  try {
    const { from, to, request, artifact_url = null } = req.body;
    if (!from || !to || !request) {
      return res.status(400).json({ error: 'from, to, and request are required' });
    }
    if (!VALID_USERS.includes(from)) return res.status(400).json({ error: `invalid from user: ${from}` });
    if (!VALID_USERS.includes(to))   return res.status(400).json({ error: `invalid to user: ${to}` });
    if (from === to) return res.status(400).json({ error: 'from and to must differ' });

    const id = randomUUID();
    db.prepare(`
      INSERT INTO shared_requests (id, from_user, to_user, request, artifact_url, status)
      VALUES (?, ?, ?, ?, ?, 'pending')
    `).run(id, from, to, request, artifact_url);

    const row = db.prepare('SELECT * FROM shared_requests WHERE id = ?').get(id);
    return res.status(201).json(row);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ── GET /api/shared-requests ──────────────────────────────────────────────────
router.get('/', (req, res) => {
  try {
    let sql = 'SELECT * FROM shared_requests WHERE 1=1';
    const params = [];

    if (req.query.to)     { sql += ' AND to_user = ?';  params.push(req.query.to); }
    if (req.query.from)   { sql += ' AND from_user = ?'; params.push(req.query.from); }
    if (req.query.status) { sql += ' AND status = ?';   params.push(req.query.status); }

    sql += " ORDER BY CASE status WHEN 'pending' THEN 0 ELSE 1 END, created_at DESC";

    const rows = db.prepare(sql).all(...params);
    return res.json(rows);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ── PATCH /api/shared-requests/:id ───────────────────────────────────────────
router.patch('/:id', (req, res) => {
  try {
    const row = db.prepare('SELECT * FROM shared_requests WHERE id = ?').get(req.params.id);
    if (!row) return res.status(404).json({ error: 'Not found' });

    const { status } = req.body;
    if (!status) return res.status(400).json({ error: 'status is required' });
    if (!VALID_STATUSES.includes(status)) {
      return res.status(400).json({ error: `invalid status: ${status}. Must be one of: ${VALID_STATUSES.join(', ')}` });
    }

    db.prepare(`
      UPDATE shared_requests SET status = ?, updated_at = datetime('now') WHERE id = ?
    `).run(status, req.params.id);

    const updated = db.prepare('SELECT * FROM shared_requests WHERE id = ?').get(req.params.id);
    return res.json(updated);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ── DELETE /api/shared-requests/:id ──────────────────────────────────────────
router.delete('/:id', (req, res) => {
  try {
    const row = db.prepare('SELECT * FROM shared_requests WHERE id = ?').get(req.params.id);
    if (!row) return res.status(404).json({ error: 'Not found' });

    db.prepare('DELETE FROM shared_requests WHERE id = ?').run(req.params.id);
    return res.status(204).send();
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

module.exports = router;
