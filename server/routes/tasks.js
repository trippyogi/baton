'use strict';
const express = require('express');
const db      = require('../db');
const router  = express.Router();
const { randomUUID } = require('crypto');

const VALID_STATUSES  = ['inbox','ready','in_progress','waiting','review','done','backlog','archived'];
const VALID_PRIORITIES = ['low','medium','high','critical'];

router.get('/', (req, res) => {
  try {
    // Exclude archived by default; pass ?include_archived=true to see them
    const includeArchived = req.query.include_archived === 'true';
    let sql = includeArchived
      ? 'SELECT * FROM tasks WHERE 1=1'
      : "SELECT * FROM tasks WHERE status != 'archived'";
    const params = [];
    if (req.query.status)   { sql += ' AND status = ?';   params.push(req.query.status); }
    if (req.query.priority) { sql += ' AND priority = ?'; params.push(req.query.priority); }
    if (req.query.owner)    { sql += ' AND owner = ?';    params.push(req.query.owner); }
    sql += " ORDER BY CASE priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END, created_at ASC";
    const tasks = db.prepare(sql).all(...params);
    res.json(tasks.map(parse));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/:id', (req, res) => {
  try {
    const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(req.params.id);
    if (!task) return res.status(404).json({ error: 'Not found' });
    res.json(parse(task));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/', (req, res) => {
  try {
    const { title, description='', status='inbox', priority='medium', owner='vector', tags=[], due_at=null, linked_run_ids=[], impact_score=0, effort_score=0 } = req.body;
    if (!title) return res.status(400).json({ error: 'title is required' });
    if (status && !VALID_STATUSES.includes(status))   return res.status(400).json({ error: `invalid status: ${status}` });
    if (priority && !VALID_PRIORITIES.includes(priority)) return res.status(400).json({ error: `invalid priority: ${priority}` });

    const id = randomUUID();
    db.prepare(`
      INSERT INTO tasks (id,title,description,status,priority,owner,tags,due_at,linked_run_ids,impact_score,effort_score)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)
    `).run(id, title, description, status, priority, owner, JSON.stringify(tags), due_at, JSON.stringify(linked_run_ids), impact_score, effort_score);

    res.status(201).json(parse(db.prepare('SELECT * FROM tasks WHERE id = ?').get(id)));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.patch('/:id', (req, res) => {
  try {
    const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(req.params.id);
    if (!task) return res.status(404).json({ error: 'Not found' });

    const allowed = ['title','description','status','priority','owner','tags','due_at','linked_run_ids','impact_score','effort_score'];
    const updates = [];
    const vals = [];
    for (const key of allowed) {
      if (key in req.body) {
        updates.push(`${key} = ?`);
        vals.push(['tags','linked_run_ids'].includes(key) ? JSON.stringify(req.body[key]) : req.body[key]);
      }
    }
    if (!updates.length) return res.status(400).json({ error: 'No valid fields to update' });
    updates.push('updated_at = datetime(\'now\')');
    vals.push(req.params.id);
    db.prepare(`UPDATE tasks SET ${updates.join(', ')} WHERE id = ?`).run(...vals);
    res.json(parse(db.prepare('SELECT * FROM tasks WHERE id = ?').get(req.params.id)));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/:id', (req, res) => {
  try {
    const result = db.prepare('DELETE FROM tasks WHERE id = ?').run(req.params.id);
    if (!result.changes) return res.status(404).json({ error: 'Not found' });
    res.json({ deleted: req.params.id });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

function parse(t) {
  return { ...t, tags: JSON.parse(t.tags || '[]'), linked_run_ids: JSON.parse(t.linked_run_ids || '[]') };
}

module.exports = router;
