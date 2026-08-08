import { Router } from 'express';
import type { Request, Response } from 'express';

type Stmt = {
  all: (...params: unknown[]) => unknown[];
  get: (...params: unknown[]) => Record<string, unknown> | undefined;
  run: (...params: unknown[]) => unknown;
};

type DbLike = {
  prepare: (sql: string) => Stmt;
};

type FlowDeps = {
  db: DbLike;
  VALID_MODES: readonly string[];
  normalizeMode: (mode: unknown) => string;
  loadSettings: (db: DbLike) => Record<string, unknown>;
  rebuildTouches: (db: DbLike) => unknown;
  listOpenTouches: (db: DbLike, limit: number) => unknown;
  rankOpenTouches: (db: DbLike) => unknown;
  executeCommand: (db: DbLike, input: string) => {
    error?: unknown;
    created?: boolean;
    [key: string]: unknown;
  };
};

export function createFlowRouter(deps: FlowDeps): Router {
  const {
    db, VALID_MODES, normalizeMode, loadSettings, rebuildTouches,
    listOpenTouches, rankOpenTouches, executeCommand,
  } = deps;
  const router = Router();

  function countTask(status: string): number {
    return Number(db.prepare('SELECT COUNT(*) AS n FROM tasks WHERE status = ?').get(status)?.n ?? 0);
  }

  function getAirspace(): Record<string, number> {
    const stale = Number(db.prepare(`
    SELECT COUNT(*) AS n FROM tasks
    WHERE status = 'in_progress'
      AND updated_at <= datetime('now', '-30 minutes')
  `).get()?.n ?? 0);
    const failed = Number(db.prepare(`SELECT COUNT(*) AS n FROM runs WHERE status IN ('failed', 'error')`).get()?.n ?? 0);
    return {
      running: countTask('in_progress'),
      needs_touch: countTask('waiting'),
      review: countTask('review'),
      idle: Number(db.prepare("SELECT COUNT(*) AS n FROM agents WHERE status = 'idle'").get()?.n ?? 0),
      stale,
      failed,
      ready_to_pass: countTask('ready'),
      prepared: Number(db.prepare("SELECT COUNT(*) AS n FROM baton_touches WHERE status = 'prepared'").get()?.n ?? 0),
      inbox: countTask('inbox'),
    };
  }

  router.get('/', (req: Request, res: Response) => {
    try {
      rankOpenTouches(db);
      const settings = loadSettings(db);
      const limit = Number(req.query.limit || settings.max_visible_touches || 7);
      res.json({
        mode: settings.current_mode,
        settings: {
          max_visible_touches: settings.max_visible_touches,
          review_debt_limit: settings.review_debt_limit,
          agent_wip_limit: settings.agent_wip_limit,
          active_context_key: settings.active_context_key,
          active_project_key: settings.active_project_key,
        },
        airspace: getAirspace(),
        next_touches: listOpenTouches(db, limit),
      });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'flow overview failed' });
    }
  });

  router.patch('/mode', (req: Request, res: Response) => {
    try {
      const body = (req.body || {}) as Record<string, unknown>;
      const mode = normalizeMode(body.mode);
      if (!VALID_MODES.includes(mode)) {
        return res.status(400).json({ error: `invalid mode: ${body.mode}` });
      }
      db.prepare(`
      UPDATE flow_settings
      SET current_mode = ?, active_context_key = COALESCE(?, active_context_key),
          active_project_key = COALESCE(?, active_project_key), updated_at = datetime('now')
      WHERE id = 'default'
    `).run(mode, body.active_context_key ?? null, body.active_project_key ?? null);
      rebuildTouches(db);
      const settings = loadSettings(db);
      res.json({
        mode: settings.current_mode,
        active_context_key: settings.active_context_key,
        active_project_key: settings.active_project_key,
        updated_at: settings.updated_at,
      });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'flow mode update failed' });
    }
  });

  router.post('/command', (req: Request, res: Response) => {
    try {
      const body = (req.body || {}) as Record<string, unknown>;
      const result = executeCommand(db, String(body.input || ''));
      if (result.error) return res.status(400).json(result);
      res.status(result.created ? 201 : 200).json(result);
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'flow command failed' });
    }
  });

  return router;
}
