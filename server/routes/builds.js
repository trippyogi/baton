'use strict';
const express = require('express');
const db      = require('../db');
const router  = express.Router();
const { randomUUID } = require('crypto');

router.get('/', (req, res) => {
  try {
    const builds = db.prepare(
      'SELECT * FROM builds ORDER BY created_at DESC'
    ).all();
    res.json(builds.map(parse));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/:id', (req, res) => {
  try {
    const b = db.prepare('SELECT * FROM builds WHERE id = ?').get(req.params.id);
    if (!b) return res.status(404).json({ error: 'Not found' });
    res.json(parse(b));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/', (req, res) => {
  try {
    const { name, description='', type='tool', status='shipped', path='', tags=[], built_by='vector+circuit', nightly_date=null, notes='' } = req.body;
    if (!name) return res.status(400).json({ error: 'name required' });
    const id = randomUUID();
    db.prepare(`
      INSERT INTO builds (id,name,description,type,status,path,tags,built_by,nightly_date,notes)
      VALUES (?,?,?,?,?,?,?,?,?,?)
    `).run(id, name, description, type, status, path, JSON.stringify(tags), built_by, nightly_date, notes);
    res.status(201).json(parse(db.prepare('SELECT * FROM builds WHERE id = ?').get(id)));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.patch('/:id', (req, res) => {
  try {
    const b = db.prepare('SELECT * FROM builds WHERE id = ?').get(req.params.id);
    if (!b) return res.status(404).json({ error: 'Not found' });
    const allowed = ['name','description','type','status','path','tags','notes'];
    const updates = [], vals = [];
    for (const key of allowed) {
      if (key in req.body) {
        updates.push(`${key} = ?`);
        vals.push(key === 'tags' ? JSON.stringify(req.body[key]) : req.body[key]);
      }
    }
    if (!updates.length) return res.status(400).json({ error: 'nothing to update' });
    vals.push(req.params.id);
    db.prepare(`UPDATE builds SET ${updates.join(', ')} WHERE id = ?`).run(...vals);
    res.json(parse(db.prepare('SELECT * FROM builds WHERE id = ?').get(req.params.id)));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

function parse(b) {
  return { ...b, tags: JSON.parse(b.tags || '[]') };
}

module.exports = router;
