'use strict';
const fs      = require('fs');
const path    = require('path');
const express = require('express');
const router  = express.Router();

const CREATIVE_LOG = path.resolve('/home/ubuntu/clawd/config/creative-log.json');

router.get('/', (_req, res) => {
  try {
    const raw  = fs.readFileSync(CREATIVE_LOG, 'utf8');
    const data = JSON.parse(raw);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: true, message: err.message });
  }
});

module.exports = router;
