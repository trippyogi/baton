import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { afterEach, describe, expect, it } from 'vitest';
import { ConflictError, InvalidTransitionError } from '../domain/errors';
import { createDecisionRequest, answerDecisionRequest, cancelDecisionRequest } from './decision-requests';
import { createChildRun, transitionRun } from './run-transitions';
import { transitionTask } from './task-transitions';

const require = createRequire(__filename);
const Database = require('better-sqlite3') as typeof import('better-sqlite3');
const { applyMigrations } = require('../../../../scripts/lib/migrate-db.js') as {
  applyMigrations: (
    db: import('better-sqlite3').Database,
    opts: { dbPath: string; backup: boolean }
  ) => unknown;
};

const ROOT = path.join(__dirname, '..', '..', '..', '..');

function openMigratedDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'baton-domain-'));
  const dbPath = path.join(dir, 't.db');
  const db = new Database(dbPath);
  db.pragma('foreign_keys = ON');
  db.exec(fs.readFileSync(path.join(ROOT, 'server', 'schema.sql'), 'utf8'));
  applyMigrations(db, { dbPath, backup: false });
  return { db, dir };
}

describe('transition services', () => {
  let cleanup: string | null = null;

  afterEach(() => {
    if (cleanup) {
      try {
        fs.rmSync(cleanup, { recursive: true, force: true });
      } catch (_) {
        /* ignore */
      }
      cleanup = null;
    }
  });

  it('enforces task OCC and transitions', () => {
    const { db, dir } = openMigratedDb();
    cleanup = dir;
    db.prepare(
      `INSERT INTO tasks (id, title, status, version, objective, acceptance_criteria_json, why_now_json, legacy_payload_json)
       VALUES ('t1', 'Task', 'ready', 1, 'obj', '[]', '{}', '{}')`
    ).run();

    const updated = transitionTask(db, { taskId: 't1', toStatus: 'in_progress', expectedVersion: 1 });
    expect(updated.status).toBe('in_progress');
    expect(updated.version).toBe(2);
    expect(() =>
      transitionTask(db, { taskId: 't1', toStatus: 'blocked', expectedVersion: 1 })
    ).toThrow(ConflictError);
  });

  it('rejects running without ACK and blocks terminal reopen', () => {
    const { db, dir } = openMigratedDb();
    cleanup = dir;
    db.prepare(
      `INSERT INTO tasks (id, title, status, version, objective, acceptance_criteria_json, why_now_json, legacy_payload_json)
       VALUES ('t1', 'Task', 'in_progress', 1, 'obj', '[]', '{}', '{}')`
    ).run();
    db.prepare(
      `INSERT INTO runs (id, task_id, status, version, attempt_number, kind, input_snapshot_json, policy_json, created_at, updated_at)
       VALUES ('r1', 't1', 'dispatched', 1, 1, 'execute', '{}', '{}', datetime('now'), datetime('now'))`
    ).run();

    expect(() => transitionRun(db, { runId: 'r1', toStatus: 'running', expectedVersion: 1 })).toThrow(
      InvalidTransitionError
    );

    transitionRun(db, { runId: 'r1', toStatus: 'acknowledged', expectedVersion: 1 });
    const running = transitionRun(db, { runId: 'r1', toStatus: 'running', expectedVersion: 2 });
    expect(running.status).toBe('running');

    const completed = transitionRun(db, {
      runId: 'r1',
      toStatus: 'validating_result',
      expectedVersion: 3,
    });
    expect(completed.status).toBe('validating_result');
    const terminal = transitionRun(db, { runId: 'r1', toStatus: 'completed', expectedVersion: 4 });
    expect(terminal.status).toBe('completed');
    expect(() => transitionRun(db, { runId: 'r1', toStatus: 'running', expectedVersion: 5 })).toThrow(
      InvalidTransitionError
    );
  });

  it('creates linear child runs and DecisionRequest CRUD', () => {
    const { db, dir } = openMigratedDb();
    cleanup = dir;
    db.prepare(
      `INSERT INTO tasks (id, title, status, version, objective, acceptance_criteria_json, why_now_json, legacy_payload_json)
       VALUES ('t1', 'Task', 'in_progress', 1, 'obj', '[]', '{}', '{}')`
    ).run();
    db.prepare(
      `INSERT INTO runs (id, task_id, status, version, attempt_number, kind, input_snapshot_json, policy_json, created_at, updated_at)
       VALUES ('r1', 't1', 'completed', 1, 1, 'execute', '{}', '{}', datetime('now'), datetime('now'))`
    ).run();

    const { child } = createChildRun(db, { parentRunId: 'r1', kind: 'refine' });
    expect(child.parent_run_id).toBe('r1');
    expect(child.attempt_number).toBe(2);
    expect(() => createChildRun(db, { parentRunId: 'r1' })).toThrow(ConflictError);

    const decision = createDecisionRequest(db, {
      question: 'Ship now?',
      taskId: 't1',
      options: ['yes', 'no'],
    });
    expect(decision.status).toBe('open');
    const answered = answerDecisionRequest(db, decision.id, { choice: 'yes' }, 1);
    expect(answered.status).toBe('answered');
    expect(JSON.parse(String(answered.response_json)).choice).toBe('yes');
    expect(() => cancelDecisionRequest(db, decision.id, 2)).toThrow(InvalidTransitionError);
  });
});
