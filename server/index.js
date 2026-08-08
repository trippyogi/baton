'use strict';

require('dotenv').config();

const express = require('express');
const fs      = require('fs');
const path    = require('path');
const db      = require('./db');
const { rebuildTouches, loadSettings, parseTouch, rankOpenTouches, listOpenTouches } = require('./lib/flow/rebuild');
const { parseJson, stringifyJson, id } = require('./lib/flow/utils');
const { sqliteDateTimeAfterMs, toSqliteDateTime } = require('./lib/flow/time');
const { isActionAllowed } = require('./lib/flow/actions');
const { markDomainTouched } = require('./lib/flow/portfolio');
const { VALID_MODES, normalizeMode } = require('./lib/flow/modes');
const { executeCommand } = require('./lib/flow/commands');
const { validateReviewPacket, normalizeList } = require('./lib/flow/quality');
const { createStrategyPacket, listStrategyPackets, getStrategyPacket } = require('./lib/strategy-packets');
const { loadTypedApi } = require('./lib/typed-api');
const { applyAccepted, applyFailed, publicBaseUrl, dispatchRun, resolveDispatch } = require('./lib/dispatch');
const { buildDispatchEnvelope } = require('./lib/dispatch/envelope');
const { apiAuthMiddleware, shouldRequireApiToken } = require('./middleware/api-auth');

function createQueueRedis() {
  const Redis = require('ioredis');
  const redis = new Redis(process.env.REDIS_URL || 'redis://127.0.0.1:6379', {
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
    connectTimeout: 250,
  });
  redis.on('error', () => {
    // Queue status is diagnostic only.
  });
  return redis;
}

function createApp(options = {}) {
  const host = options.host || process.env.BATON_HOST || process.env.HOST || '127.0.0.1';
  const app = express();
  const typed = loadTypedApi();

  if (typed?.requestIdMiddleware) app.use(typed.requestIdMiddleware);
  if (typed?.requestLogMiddleware) app.use(typed.requestLogMiddleware);

  app.use(express.json({
    verify: (req, _res, buf) => { req.rawBody = buf; },
  }));
  const webDist = path.join(__dirname, '..', 'apps', 'web', 'dist');
  const publicDir = path.join(__dirname, '..', 'public');
  const useWebDist = fs.existsSync(path.join(webDist, 'index.html'));
  if (useWebDist) {
    app.use(express.static(webDist));
  }
  app.use(express.static(publicDir));
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
  if (typed?.createTasksRouter) {
    app.use('/api/tasks', typed.createTasksRouter({
      db,
      parseJson,
      stringifyJson,
      rebuildTouches,
      loadSettings,
      parseTouch,
      buildDispatchEnvelope,
      publicBaseUrl,
    }));
  } else {
    app.use('/api/tasks', require('./routes/tasks'));
  }
  if (typed?.createRunsRouter) {
    app.use('/api/runs', typed.createRunsRouter({
      db,
      parseJson,
      stringifyJson,
      rebuildTouches,
      applyAccepted,
      applyFailed,
    }));
  } else {
    app.use('/api/runs', require('./routes/runs'));
  }
  if (typed?.createAlertsRouter) {
    app.use('/api/alerts', typed.createAlertsRouter(db));
  } else {
    app.use('/api/alerts', require('./routes/alerts'));
  }
  if (typed?.createBuildsRouter) {
    app.use('/api/builds', typed.createBuildsRouter(db));
  } else {
    app.use('/api/builds', require('./routes/builds'));
  }
  app.use('/api/costs',       require('./routes/costs'));
  app.use('/api/performance', require('./routes/performance'));
  if (typed?.createMemoryRouter) {
    app.use('/api/memory', typed.createMemoryRouter());
  } else {
    app.use('/api/memory', require('./routes/memory'));
  }
  if (typed?.createTeamRouter) {
    app.use('/api/team', typed.createTeamRouter());
  } else {
    app.use('/api/team', require('./routes/team'));
  }
  if (typed?.createFlowRouter) {
    app.use('/api/flow', typed.createFlowRouter({
      db,
      VALID_MODES,
      normalizeMode,
      loadSettings,
      rebuildTouches,
      listOpenTouches,
      rankOpenTouches,
      executeCommand,
    }));
  } else {
    app.use('/api/flow', require('./routes/flow'));
  }
  if (typed?.createTouchesRouter) {
    app.use('/api/touches', typed.createTouchesRouter({
      db,
      id,
      stringifyJson,
      sqliteDateTimeAfterMs,
      toSqliteDateTime,
      isActionAllowed,
      rebuildTouches,
      parseTouch,
      rankOpenTouches,
      markDomainTouched,
      dispatchRun,
    }));
  } else {
    app.use('/api/touches', require('./routes/touches'));
  }
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
  if (typed?.createReviewPacketsRouter) {
    app.use('/api/review-packets', typed.createReviewPacketsRouter({
      db,
      id,
      stringifyJson,
      parseJson,
      validateReviewPacket,
      normalizeList,
      rebuildTouches,
    }));
  } else {
    app.use('/api/review-packets', require('./routes/review-packets'));
  }
  if (typed?.createStrategyPacketsRouter) {
    app.use('/api/strategy-packets', typed.createStrategyPacketsRouter({
      db,
      listStrategyPackets,
      getStrategyPacket,
      createStrategyPacket,
    }));
  } else {
    app.use('/api/strategy-packets', require('./routes/strategy-packets'));
  }
  if (typed?.createQueueRouter) {
    app.use('/api/queue', typed.createQueueRouter({
      db,
      redis: createQueueRedis(),
    }));
  } else {
    app.use('/api/queue', require('./routes/queue'));
  }
  if (typed?.createDispatchRouter) {
    app.use('/api/dispatch', typed.createDispatchRouter({
      db,
      id,
      loadSettings,
      buildDispatchEnvelope,
      resolveDispatch,
      dispatchRun,
      publicBaseUrl,
    }));
  } else {
    app.use('/api/dispatch', require('./routes/dispatch'));
  }
  if (typed?.createWebhookRouter) {
    app.use('/api/webhook/github', typed.createWebhookRouter({
      db,
      redis: createQueueRedis(),
    }));
  } else {
    app.use('/api/webhook/github', require('./routes/webhook'));
  }
  if (typed?.createSharedRequestsRouter) {
    app.use('/api/shared-requests', typed.createSharedRequestsRouter(db));
  } else {
    app.use('/api/shared-requests', require('./routes/shared-requests'));
  }
  if (typed?.createCreativesRouter) {
    app.use('/api/creatives', typed.createCreativesRouter());
  } else {
    app.use('/api/creatives', require('./routes/creatives'));
  }

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
    const webIndex = path.join(webDist, 'index.html');
    res.sendFile(useWebDist ? webIndex : path.join(publicDir, 'index.html'));
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
