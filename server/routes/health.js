'use strict';
const express = require('express');
const db = require('../db');

const router = express.Router();

router.get('/', (_req, res) => {
  try {
    db.prepare('SELECT 1 AS ok').get();
    const demoData = isDemoData();
    res.json({
      ok: true,
      app: 'baton',
      db: true,
      demo_data: demoData,
      demo_company: demoData ? 'Demo Co' : null,
      redis_required: false,
      redis: 'unknown',
    });
  } catch (err) {
    res.status(500).json({ ok: false, app: 'baton', db: false, redis_required: false, redis: 'unknown', error: err.message });
  }
});

function isDemoData() {
  try {
    const row = db.prepare("SELECT value FROM app_metadata WHERE key = 'demo_data'").get();
    return row?.value === 'seed-demo';
  } catch (_) {
    return false;
  }
}

module.exports = router;
