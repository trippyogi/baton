'use strict';
const express = require('express');
const db = require('../db');
const { createStrategyPacket, listStrategyPackets, getStrategyPacket } = require('../lib/strategy-packets');

const router = express.Router();

router.get('/', (req, res) => {
  try {
    res.json(listStrategyPackets(db, req.query.limit || 25));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/:id', (req, res) => {
  try {
    const packet = getStrategyPacket(db, req.params.id);
    if (!packet) return res.status(404).json({ error: 'Not found' });
    res.json(packet);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/', (req, res) => {
  try {
    const result = createStrategyPacket(db, req.body || {});
    res.status(201).json(result);
  } catch (err) {
    const status = /goal is required/i.test(err.message) ? 400 : 500;
    res.status(status).json({ error: err.message });
  }
});

module.exports = router;
