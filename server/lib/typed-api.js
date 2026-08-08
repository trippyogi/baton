'use strict';

const fs = require('fs');
const path = require('path');

/**
 * Load compiled TypeScript route/middleware factories from apps/api/dist.
 * Returns null when the build output is missing.
 */
function loadTypedApi() {
  const typedApiDist = path.join(__dirname, '..', '..', 'apps', 'api', 'dist');
  try {
    return {
      requestIdMiddleware: require(path.join(typedApiDist, 'middleware', 'request-id.js')).requestIdMiddleware,
      errorMiddleware: require(path.join(typedApiDist, 'middleware', 'errors.js')).errorMiddleware,
      createHealthRouter: require(path.join(typedApiDist, 'routes', 'health.js')).createHealthRouter,
      createOverviewRouter: require(path.join(typedApiDist, 'routes', 'overview.js')).createOverviewRouter,
      createAgentsRouter: require(path.join(typedApiDist, 'routes', 'agents.js')).createAgentsRouter,
      createAlertsRouter: require(path.join(typedApiDist, 'routes', 'alerts.js')).createAlertsRouter,
      createRunsRouter: require(path.join(typedApiDist, 'routes', 'runs.js')).createRunsRouter,
      createTasksRouter: require(path.join(typedApiDist, 'routes', 'tasks.js')).createTasksRouter,
      createBuildsRouter: require(path.join(typedApiDist, 'routes', 'builds.js')).createBuildsRouter,
      createTouchesRouter: require(path.join(typedApiDist, 'routes', 'touches.js')).createTouchesRouter,
      createFlowRouter: require(path.join(typedApiDist, 'routes', 'flow.js')).createFlowRouter,
      createDispatchRouter: require(path.join(typedApiDist, 'routes', 'dispatch.js')).createDispatchRouter,
      createTeamRouter: require(path.join(typedApiDist, 'routes', 'team.js')).createTeamRouter,
      createReviewPacketsRouter: require(path.join(typedApiDist, 'routes', 'review-packets.js')).createReviewPacketsRouter,
      createQueueRouter: require(path.join(typedApiDist, 'routes', 'queue.js')).createQueueRouter,
      createMemoryRouter: require(path.join(typedApiDist, 'routes', 'memory.js')).createMemoryRouter,
      createCreativesRouter: require(path.join(typedApiDist, 'routes', 'creatives.js')).createCreativesRouter,
      createStrategyPacketsRouter: require(path.join(typedApiDist, 'routes', 'strategy-packets.js')).createStrategyPacketsRouter,
      createSharedRequestsRouter: require(path.join(typedApiDist, 'routes', 'shared-requests.js')).createSharedRequestsRouter,
      createWebhookRouter: require(path.join(typedApiDist, 'routes', 'webhook.js')).createWebhookRouter,
      requestLogMiddleware: require(path.join(typedApiDist, 'middleware', 'errors.js')).requestLogMiddleware,
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
