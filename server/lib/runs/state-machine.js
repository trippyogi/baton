'use strict';
const { stringifyJson } = require('../flow/utils');

const TERMINAL = new Set(['completed', 'failed', 'cancelled']);
const ACTIVE = new Set(['pending_dispatch', 'dispatched', 'running', 'blocked', 'review_ready']);

function isTerminal(status) {
  return TERMINAL.has(status);
}

function isActive(status) {
  return ACTIVE.has(status);
}

function ensureRunEventsTable(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS run_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      from_status TEXT,
      to_status TEXT,
      actor TEXT DEFAULT 'system',
      payload TEXT DEFAULT '{}',
      created_at TEXT DEFAULT (datetime('now'))
    );
  `);
}

function recordRunEvent(db, { runId, event, fromStatus, toStatus, actor = 'system', payload = {} }) {
  ensureRunEventsTable(db);
  db.prepare(`
    INSERT INTO run_events (run_id, event_type, from_status, to_status, actor, payload)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(runId, event, fromStatus || null, toStatus || null, actor, stringifyJson(payload));
}

function transitionRun({ db, runId, event, toStatus, actor = 'system', payload = {}, allowIdempotent = true }) {
  const run = db.prepare('SELECT * FROM runs WHERE id = ?').get(runId);
  if (!run) return { ok: false, code: 'not_found', status: 404, error: 'Run not found.' };

  if (isTerminal(run.status) && run.status !== toStatus) {
    recordRunEvent(db, { runId, event, fromStatus: run.status, toStatus: run.status, actor, payload: { ...payload, ignored: true, reason: 'terminal_state' } });
    return { ok: false, ignored: true, code: 'terminal_state', status: 409, run };
  }

  if (allowIdempotent && run.status === toStatus) {
    recordRunEvent(db, { runId, event, fromStatus: run.status, toStatus, actor, payload: { ...payload, idempotent: true } });
    return { ok: true, idempotent: true, run };
  }

  const allowed = allowedTransitions(run.status);
  if (!allowed.has(toStatus)) {
    recordRunEvent(db, { runId, event, fromStatus: run.status, toStatus: run.status, actor, payload: { ...payload, rejected: true, requested_status: toStatus } });
    return { ok: false, code: 'invalid_transition', status: 409, error: `Invalid run transition ${run.status} -> ${toStatus}.`, run };
  }

  const ended = TERMINAL.has(toStatus) ? ', ended_at = COALESCE(ended_at, datetime(\'now\'))' : '';
  const started = ['running', 'blocked', 'review_ready'].includes(toStatus) ? ', started_at = COALESCE(started_at, datetime(\'now\'))' : '';
  db.prepare(`UPDATE runs SET status = ?, last_status_at = datetime('now')${started}${ended} WHERE id = ?`).run(toStatus, runId);
  recordRunEvent(db, { runId, event, fromStatus: run.status, toStatus, actor, payload });
  return { ok: true, run: db.prepare('SELECT * FROM runs WHERE id = ?').get(runId) };
}

function allowedTransitions(status) {
  switch (status) {
    case 'pending':
      return new Set(['pending_dispatch', 'dispatched', 'running', 'failed', 'cancelled']);
    case 'pending_dispatch':
      return new Set(['dispatched', 'running', 'failed', 'cancelled']);
    case 'dispatched':
      return new Set(['running', 'failed', 'cancelled']);
    case 'running':
      return new Set(['blocked', 'review_ready', 'completed', 'failed', 'cancelled']);
    case 'blocked':
      return new Set(['running', 'failed', 'cancelled']);
    case 'review_ready':
      return new Set(['completed', 'cancelled']);
    default:
      return new Set(['failed', 'cancelled']);
  }
}

module.exports = { transitionRun, isTerminal, isActive, ensureRunEventsTable };
