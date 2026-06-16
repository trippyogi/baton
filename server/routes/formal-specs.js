'use strict';
const express = require('express');
const db = require('../db');
const { createFormalSpecPacket, parseFormalSpec } = require('../lib/formal-specs');

const router = express.Router();

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
