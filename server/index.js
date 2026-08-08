'use strict';

require('dotenv').config();

const express = require('express');
const fs      = require('fs');
const path    = require('path');
const db      = require('./db');
const { rebuildTouches } = require('./lib/flow/rebuild');
const { parseJson, stringifyJson } = require('./lib/flow/utils');
const { loadTypedApi } = require('./lib/typed-api');
const { apiAuthMiddleware, shouldRequireApiToken } = require('./middleware/api-auth');

function createApp(options = {}) {
  const host = options.host || process.env.BATON_HOST || process.env.HOST || '127.0.0.1';
  const app = express();
  const typed = loadTypedApi();

  if (typed?.requestIdMiddleware) app.use(typed.requestIdMiddleware);

  app.use(express.json({
    verify: (req, _res, buf) => { req.rawBody = buf; },
  }));
  app.use(express.static(path.join(__dirname, '..', 'public')));
  app.use('/api', apiAuthMiddleware(host));

  if (typed?.createHealthRouter) {
    app.use('/api/health', typed.createHealthRouter(db));
  } else {
    app.use('/api/health', require('./routes/health'));
  }
  if (typed?.createOverviewRouter) {
    app.use('/api/overview', typed.createOverviewRouter(db));
  } else {
    app.use('/api/overview', require('./routes/overview'));
  }
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
  if (typed?.createAgentsRouter) {
    app.use('/api/agents', typed.createAgentsRouter({
      db,
      parseJson,
      stringifyJson,
      rebuildTouches,
    }));
  } else {
    app.use('/api/agents', require('./routes/agents'));
  }
  app.use('/api/review-packets', require('./routes/review-packets'));
  app.use('/api/strategy-packets', require('./routes/strategy-packets'));
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

  // Presence is decided by the filesystem; any load/register failure is fatal.
  const internalExtensionPaths = [
    path.join(__dirname, '..', 'baton-internal', 'extension.js'),
    path.join(__dirname, '..', 'baton-internal', 'extension', 'index.js'),
  ];
  const internalExtensionPresent = internalExtensionPaths.some((candidate) => fs.existsSync(candidate));
  if (!internalExtensionPresent) {
    console.log('[baton] Running without internal extension');
  } else {
    try {
      const internalExtension = require('../baton-internal/extension');
      internalExtension.register(app, db);
      console.log('[baton] Internal extension loaded');
    } catch (err) {
      console.error('[baton] Internal extension failed to load:', err);
      process.exit(1);
    }
  }

  app.get('*', (_req, res) => {
    res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
  });

  if (typed?.errorMiddleware) app.use(typed.errorMiddleware);

  return app;
}

function startServer(options = {}) {
  const port = Number(options.port || process.env.VMC_PORT || process.env.PORT || 4200);
  const host = options.host || process.env.BATON_HOST || process.env.HOST || '127.0.0.1';
  const app = options.app || createApp({ host });

  const server = app.listen(port, host, () => {
    console.log(`BATON running at http://${host}:${port}`);
    if (shouldRequireApiToken(host)) {
      console.log(process.env.BATON_API_TOKEN
        ? '[baton] API bearer auth enabled.'
        : '[baton] WARNING: non-localhost bind requires BATON_API_TOKEN for API routes.');
    }
    if (process.env.BATON_SSH_HINT) console.log(process.env.BATON_SSH_HINT);
  });

  const shutdown = (sig) => {
    console.log(`\n${sig} — shutting down...`);
    server.close(() => {
      try { db.close(); } catch (_) { /* already closed */ }
      process.exit(0);
    });
    setTimeout(() => {
      try { db.close(); } catch (_) { /* already closed */ }
      process.exit(1);
    }, 5000);
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT',  () => shutdown('SIGINT'));

  return server;
}

if (require.main === module) {
  startServer();
}

module.exports = { createApp, startServer };
