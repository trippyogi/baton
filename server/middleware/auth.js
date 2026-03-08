'use strict';
/**
 * Bearer token auth middleware for shared-requests routes.
 * Checks Authorization: Bearer <SHARED_REQUESTS_TOKEN>
 */
module.exports = function requireSharedToken(req, res, next) {
  const token = process.env.SHARED_REQUESTS_TOKEN;
  if (!token) {
    return res.status(503).json({ error: 'SHARED_REQUESTS_TOKEN not configured on server' });
  }
  const header = req.headers.authorization || '';
  const provided = header.startsWith('Bearer ') ? header.slice(7).trim() : null;
  if (!provided || provided !== token) {
    return res.status(401).json({ error: 'Unauthorized — invalid or missing bearer token' });
  }
  next();
};
