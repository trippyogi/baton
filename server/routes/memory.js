'use strict';
const express = require('express');
const fs      = require('fs');
const path    = require('path');
const router  = express.Router();

const CORE_PATH   = '/home/ubuntu/clawd/MEMORY.md';
const MEMORY_DIR  = '/home/ubuntu/clawd/memory';

router.get('/', (_req, res) => {
  try {
    const core = fs.existsSync(CORE_PATH)
      ? fs.readFileSync(CORE_PATH, 'utf8')
      : null;

    // Find most recent daily file (today preferred, else latest)
    const today = new Date().toISOString().slice(0, 10);
    let dailyDate = null;
    let daily     = null;

    const todayPath = path.join(MEMORY_DIR, `${today}.md`);
    if (fs.existsSync(todayPath)) {
      daily     = fs.readFileSync(todayPath, 'utf8');
      dailyDate = today;
    } else if (fs.existsSync(MEMORY_DIR)) {
      const files = fs.readdirSync(MEMORY_DIR)
        .filter(f => /^\d{4}-\d{2}-\d{2}\.md$/.test(f))
        .sort()
        .reverse();
      if (files.length) {
        dailyDate = files[0].replace('.md', '');
        daily     = fs.readFileSync(path.join(MEMORY_DIR, files[0]), 'utf8');
      }
    }

    res.json({ core, daily, dailyDate });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
