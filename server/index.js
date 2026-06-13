'use strict';
require('dotenv').config();

const express = require('express');
const path    = require('path');
const db      = require('./db');
const { rebuildTouches } = require('./lib/flow/rebuild');

const app  = express();
const PORT = process.env.VMC_PORT || process.env.PORT || 4200;
const HOST = '127.0.0.1';

app.use(express.json({
  verify: (req, _res, buf) => { req.rawBody = buf; },
}));
app.use(express.static(path.join(__dirname, '..', 'public')));

// Routes
app.use('/api/health',   require('./routes/health'));
app.use('/api/overview', require('./routes/overview'));
app.use('/api/tasks',    require('./routes/tasks'));
app.use('/api/runs',     require('./routes/runs'));
app.use('/api/alerts',   require('./routes/alerts'));
app.use('/api/builds',      require('./routes/builds'));
app.use('/api/costs',       require('./routes/costs'));
app.use('/api/performance', require('./routes/performance'));
app.use('/api/memory',      require('./routes/memory'));
app.use('/api/team',        require('./routes/team'));
app.use('/api/flow',        require('./routes/flow'));
app.use('/api/touches',     require('./routes/touches'));
app.use('/api/agents',      require('./routes/agents'));
app.use('/api/review-packets', require('./routes/review-packets'));
app.use('/api/queue',       require('./routes/queue'));
app.use('/api/dispatch',    require('./routes/dispatch'));
app.use('/api/webhook/github',   require('./routes/webhook'));
app.use('/api/shared-requests', require('./routes/shared-requests'));
app.use('/api/creatives',      require('./routes/creatives'));

try {
  const result = rebuildTouches(db);
  console.log('[baton] Flow touches rebuilt on startup', result);
} catch (err) {
  console.warn('[baton] Flow startup rebuild failed:', err.message);
}

// Load internal extension if present. This must be before SPA fallback.
try {
  const ext = require('../baton-internal/extension');
  ext.register(app, db);
  console.log('[baton] Internal extension loaded');
} catch (e) {
  console.log('[baton] Running without internal extension');
}

// SPA fallback must be last.
app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

const server = app.listen(PORT, HOST, () => {
  console.log(`BATON running at http://${HOST}:${PORT}`);
  if (process.env.BATON_SSH_HINT) console.log(process.env.BATON_SSH_HINT);
});

// Graceful shutdown
const shutdown = (sig) => {
  console.log(`\n${sig} — shutting down...`);
  server.close(() => { process.exit(0); });
  setTimeout(() => process.exit(1), 5000);
};
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));