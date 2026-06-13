'use strict';
const express = require('express');
const db = require('../db');

const router = express.Router();

router.get('/', (_req, res) => {
  try {
    db.prepare('SELECT 1 AS ok').get();
    res.json({
      ok: true,
      app: 'baton',
      db: true,
      redis_required: false,
      redis: 'unknown',
    });
  } catch (err) {
    res.status(500).json({ ok: false, app: 'baton', db: false, redis_required: false, redis: 'unknown', error: err.message });
  }
});

module.exports = router;
