'use strict';
const express = require('express');
const path    = require('path');
require('dotenv').config();

const app  = express();
const PORT = process.env.VMC_PORT || 4200;
const HOST = '127.0.0.1';

app.use(express.json({
  verify: (req, _res, buf) => { req.rawBody = buf; },
}));
app.use(express.static(path.join(__dirname, '..', 'public')));

// Routes
app.use('/api/overview', require('./routes/overview'));
app.use('/api/tasks',    require('./routes/tasks'));
app.use('/api/runs',     require('./routes/runs'));
app.use('/api/alerts',   require('./routes/alerts'));
app.use('/api/builds',      require('./routes/builds'));
app.use('/api/costs',       require('./routes/costs'));
app.use('/api/performance', require('./routes/performance'));
app.use('/api/memory',      require('./routes/memory'));
app.use('/api/team',        require('./routes/team'));
app.use('/api/queue',       require('./routes/queue'));
app.use('/api/webhook/github',   require('./routes/webhook'));
app.use('/api/shared-requests', require('./routes/shared-requests'));
app.use('/api/creatives',      require('./routes/creatives'));

// SPA fallback
app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});


// Load internal extension if present
try {
  const ext = require('../baton-internal/extension');
  ext.register(app, db);
  console.log('[baton] Internal extension loaded');
} catch (e) {
  console.log('[baton] Running without internal extension');
}

const server = app.listen(PORT, HOST, () => {
  console.log(`Vector Mission Control running at http://${HOST}:${PORT}`);
  console.log(`SSH tunnel: ssh -L ${PORT}:${HOST}:${PORT} ubuntu@18.144.11.180`);
});

// Graceful shutdown
const shutdown = (sig) => {
  console.log(`\n${sig} — shutting down...`);
  server.close(() => { process.exit(0); });
  setTimeout(() => process.exit(1), 5000);
};
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));