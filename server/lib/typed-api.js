'use strict';

const fs = require('fs');
const path = require('path');

/**
 * Load compiled TypeScript route/middleware factories from apps/api/dist.
 * Returns null when the build output is missing.
 */
function loadTypedApi() {
  const typedApiDist = path.join(__dirname, '..', 'apps', 'api', 'dist');
  try {
    return {
      requestIdMiddleware: require(path.join(typedApiDist, 'middleware', 'request-id.js')).requestIdMiddleware,
      errorMiddleware: require(path.join(typedApiDist, 'middleware', 'errors.js')).errorMiddleware,
      createHealthRouter: require(path.join(typedApiDist, 'routes', 'health.js')).createHealthRouter,
      createOverviewRouter: require(path.join(typedApiDist, 'routes', 'overview.js')).createOverviewRouter,
      createAgentsRouter: require(path.join(typedApiDist, 'routes', 'agents.js')).createAgentsRouter,
    };
  } catch (err) {
    const healthDist = path.join(typedApiDist, 'routes', 'health.js');
    if (fs.existsSync(healthDist)) {
      console.error('[baton] Failed to load typed API dist; using legacy routes:', err);
    }
    return null;
  }
}

module.exports = { loadTypedApi };
