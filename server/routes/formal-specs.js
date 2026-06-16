'use strict';
const express = require('express');
const db = require('../db');
const { createFormalSpecPacket, listFormalSpecs, getFormalSpec, parseFormalSpec } = require('../lib/formal-specs');

const router = express.Router();

router.get('/', (req, res) => {
  try {
    res.json(listFormalSpecs(db, req.query.limit || 25));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/:id', (req, res) => {
  try {
    const spec = getFormalSpec(db, req.params.id);
    if (!spec) return res.status(404).json({ error: 'Not found' });
    res.json(spec);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/parse', (req, res) => {
  try {
    res.json(parseFormalSpec(String(req.body?.markdown || req.body?.body || req.body?.raw_input || ''), req.body || {}));
  } catch (err) {
    const status = /markdown is required/i.test(err.message) ? 400 : 500;
    res.status(status).json({ error: err.message });
  }
});

router.post('/', (req, res) => {
  try {
    const result = createFormalSpecPacket(db, req.body || {});
    res.status(201).json(result);
  } catch (err) {
    const status = /markdown is required|goal is required/i.test(err.message) ? 400 : 500;
    res.status(status).json({ error: err.message });
  }
});

module.exports = router;
