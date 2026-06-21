'use strict';

const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost', '::1']);

function isLocalHost(host) {
  return LOCAL_HOSTS.has(String(host || '').toLowerCase());
}

function shouldRequireApiToken(host) {
  return Boolean(process.env.BATON_API_TOKEN) || !isLocalHost(host);
}

function apiAuthMiddleware(host) {
  const requireToken = shouldRequireApiToken(host);
  if (!requireToken) return (_req, _res, next) => next();

  return (req, res, next) => {
    if (req.path === '/health') return next();
    if (/^\/runs\/[^/]+\/(ack|status)$/.test(req.path)) return next();
    if (req.path === '/review-packets' && req.method === 'POST' && req.get('x-baton-callback') === '1') return next();
    const token = process.env.BATON_API_TOKEN;
    if (!token) {
      return res.status(503).json({
        error: 'BATON_API_TOKEN required when BATON is bound outside localhost',
      });
    }
    const header = req.headers.authorization || '';
    const provided = header.startsWith('Bearer ') ? header.slice(7).trim() : null;
    if (!provided || provided !== token) {
      return res.status(401).json({ error: 'Unauthorized — invalid or missing bearer token' });
    }
    next();
  };
}

module.exports = { apiAuthMiddleware, isLocalHost, shouldRequireApiToken };
