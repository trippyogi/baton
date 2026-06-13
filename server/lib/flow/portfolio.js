'use strict';
const { clamp01 } = require('./utils');

function labelFor(id) {
  return String(id || 'product').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function getPortfolioMap(db) {
  const rows = db.prepare('SELECT * FROM portfolio_domains').all();
  const map = new Map();
  for (const row of rows) map.set(row.id, row);
  return map;
}

function domainMeta(map, domain) {
  return map.get(domain) || { id: domain, label: labelFor(domain), weight: 1.0, starvation_days: 14, last_touched_at: null };
}

function starvationScore(meta) {
  if (!meta.last_touched_at) return meta.protected_minimum ? 0.65 : 0;
  const days = Math.max(0, (Date.now() - new Date(meta.last_touched_at).getTime()) / 864e5);
  return clamp01(days / (meta.starvation_days || 14));
}

function markDomainTouched(db, domain) {
  db.prepare(`UPDATE portfolio_domains SET last_touched_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`).run(domain || 'product');
}

module.exports = { getPortfolioMap, domainMeta, starvationScore, markDomainTouched };
