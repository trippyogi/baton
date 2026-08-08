import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import type { Request, Response } from 'express';

type Stmt = {
  all: (...params: unknown[]) => unknown[];
  get: (...params: unknown[]) => Record<string, unknown> | undefined;
  run: (...params: unknown[]) => { changes?: number };
};

type DbLike = {
  prepare: (sql: string) => Stmt;
};

type TasksDeps = {
  db: DbLike;
  parseJson: <T>(raw: unknown, fallback: T) => T;
  stringifyJson: (value: unknown) => string;
  rebuildTouches: (db: DbLike) => unknown;
  loadSettings: (db: DbLike) => unknown;
  parseTouch: (row: Record<string, unknown>) => Record<string, unknown>;
  buildDispatchEnvelope: (input: Record<string, unknown>) => unknown;
  publicBaseUrl: () => string;
};

const VALID_STATUSES = ['inbox', 'ready', 'in_progress', 'waiting', 'review', 'done', 'backlog', 'archived'] as const;
const VALID_PRIORITIES = ['low', 'medium', 'high', 'critical'] as const;
const VALID_RISK_LEVELS = ['low', 'medium', 'high', 'critical'] as const;
const JSON_FIELDS = ['tags', 'linked_run_ids'] as const;
const ALLOWED_FIELDS = [
  'title', 'description', 'status', 'priority', 'owner', 'tags', 'due_at', 'linked_run_ids',
  'impact_score', 'effort_score', 'domain', 'project_key', 'context_key',
  'autonomy_level', 'risk_level', 'quality_gate', 'spec_quality',
  'human_touch_minutes', 'agent_hours_unlocked', 'confidence_score',
  'quality_score', 'fun_score', 'strategic_optionality',
] as const;

const DEFAULT_TASK: Record<string, unknown> = {
  description: '', status: 'inbox', priority: 'medium', owner: 'vector', tags: [], due_at: null,
  linked_run_ids: [], impact_score: 0, effort_score: 0, domain: 'product', project_key: null,
  context_key: null, autonomy_level: 1, risk_level: 'low', quality_gate: 'general',
  spec_quality: 'unknown', human_touch_minutes: 5, agent_hours_unlocked: 0.5,
  confidence_score: 0.7, quality_score: 0.7, fun_score: 0, strategic_optionality: 0,
};

function pick(obj: Record<string, unknown>, allowed: readonly string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of allowed) if (key in obj) out[key] = obj[key];
  return out;
}

function safeJsonArray(value: unknown): string[] {
  try {
    const parsed = JSON.parse(String(value || '[]'));
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

function parse(t: Record<string, unknown>): Record<string, unknown> {
  return { ...t, tags: safeJsonArray(t.tags), linked_run_ids: safeJsonArray(t.linked_run_ids) };
}

function normalizeStringArray(value: unknown): { ok: true; value: string[] } | { ok: false } {
  let arr: unknown = value;
  if (typeof value === 'string') {
    try { arr = JSON.parse(value); } catch { return { ok: false }; }
  }
  if (!Array.isArray(arr)) return { ok: false };
  if (!arr.every((item) => typeof item === 'string')) return { ok: false };
  return { ok: true, value: arr as string[] };
}

function clampNumber(value: unknown, min: number, max: number): number {
  const n = Number(value);
  if (Number.isNaN(n)) return NaN;
  return Math.max(min, Math.min(max, n));
}

function sqlValue(value: unknown): unknown {
  return Array.isArray(value) || (value && typeof value === 'object') ? JSON.stringify(value) : value;
}

export function createTasksRouter(deps: TasksDeps): Router {
  const {
    db, parseJson, stringifyJson, rebuildTouches, loadSettings, parseTouch,
    buildDispatchEnvelope, publicBaseUrl,
  } = deps;
  const router = Router();

  function validDomains(): string[] {
    return db.prepare('SELECT id FROM portfolio_domains').all().map((r) => String((r as { id: string }).id));
  }

  function normalizeTaskBody(
    values: Record<string, unknown>,
    { partial }: { partial: boolean },
  ): { values: Record<string, unknown> } | { error: string } {
    const out = { ...values };
    if ('status' in out && !VALID_STATUSES.includes(out.status as typeof VALID_STATUSES[number])) {
      return { error: `invalid status: ${out.status}` };
    }
    if ('priority' in out && !VALID_PRIORITIES.includes(out.priority as typeof VALID_PRIORITIES[number])) {
      return { error: `invalid priority: ${out.priority}` };
    }
    if ('risk_level' in out && !VALID_RISK_LEVELS.includes(out.risk_level as typeof VALID_RISK_LEVELS[number])) {
      return { error: `invalid risk_level: ${out.risk_level}` };
    }
    if ('domain' in out && !validDomains().includes(String(out.domain))) {
      return { error: `invalid domain: ${out.domain}` };
    }
    for (const field of JSON_FIELDS) {
      if (field in out) {
        const normalized = normalizeStringArray(out[field]);
        if (!normalized.ok) return { error: `${field} must be an array of strings` };
        out[field] = normalized.value;
      }
    }
    for (const key of ['impact_score', 'effort_score'] as const) {
      if (key in out) out[key] = clampNumber(out[key], 0, 10);
    }
    if ('autonomy_level' in out) out.autonomy_level = clampNumber(out.autonomy_level, 0, 7);
    for (const key of ['confidence_score', 'quality_score', 'fun_score', 'strategic_optionality'] as const) {
      if (key in out) out[key] = clampNumber(out[key], 0, 1);
    }
    for (const key of ['human_touch_minutes', 'agent_hours_unlocked'] as const) {
      if (key in out) out[key] = clampNumber(out[key], 0, Number.MAX_SAFE_INTEGER);
    }
    for (const [key, value] of Object.entries(out)) {
      if (Number.isNaN(value as number)) return { error: `invalid numeric value for ${key}` };
    }
    if (!partial && !out.title) return { error: 'title is required' };
    return { values: out };
  }

  function parseAgent(agent: Record<string, unknown>): Record<string, unknown> {
    return {
      ...agent,
      skills: parseJson(agent.skills, []),
      permissions: parseJson(agent.permissions, {}),
      dispatch_config: parseJson(agent.dispatch_config, {}),
    };
  }

  function parseRun(row: Record<string, unknown> | undefined): Record<string, unknown> | null {
    return row
      ? {
        ...row,
        steps: parseJson(row.steps, []),
        logs: parseJson(row.logs, []),
        dispatch_payload: parseJson(row.dispatch_payload, {}),
      }
      : null;
  }

  function latestTouchForTask(taskId: string): Record<string, unknown> | null {
    const row = db.prepare(`
    SELECT * FROM baton_touches
    WHERE task_id = ? AND status NOT IN ('archived', 'resolved')
    ORDER BY CASE status WHEN 'active' THEN 0 WHEN 'pending' THEN 1 WHEN 'prepared' THEN 2 ELSE 3 END, created_at DESC
    LIMIT 1
  `).get(taskId);
    return row ? parseTouch(row) : null;
  }

  function findPreparedDispatch(taskId: string, touchId: string | null): Record<string, unknown> | undefined {
    if (touchId) {
      return db.prepare(`
      SELECT * FROM runs
      WHERE task_id = ? AND touch_id = ? AND status = 'pending_dispatch' AND dispatch_status = 'prepared'
      ORDER BY created_at DESC
      LIMIT 1
    `).get(taskId, touchId);
    }
    return db.prepare(`
    SELECT * FROM runs
    WHERE task_id = ? AND touch_id IS NULL AND status = 'pending_dispatch' AND dispatch_status = 'prepared'
    ORDER BY created_at DESC
    LIMIT 1
  `).get(taskId);
  }

  function resolveAgent(task: Record<string, unknown>, body: Record<string, unknown>): Record<string, unknown> | null {
    const ids = [body.agent_id, task.owner, 'strategy-agent', 'ops-agent'].filter(Boolean);
    for (const agentId of ids) {
      const agent = db.prepare('SELECT * FROM agents WHERE id = ?').get(agentId as string);
      if (agent) return parseAgent(agent);
    }
    const idle = db.prepare(`SELECT * FROM agents WHERE status = 'idle' ORDER BY name LIMIT 1`).get();
    return idle ? parseAgent(idle) : null;
  }

  function normalizeInstructions(value: unknown): string[] {
    if (!value) return [];
    if (Array.isArray(value)) return value.map(String).filter(Boolean);
    return String(value).split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  }

  function prepareDispatch(task: Record<string, unknown>, body: Record<string, unknown>): Record<string, unknown> {
    const agent = resolveAgent(task, body);
    const touch = latestTouchForTask(String(task.id));
    const runId = `run_${randomUUID()}`;
    const parsedTask = parse(task);
    const instructions = normalizeInstructions(body.instructions);
    const run = {
      id: runId,
      task_id: task.id,
      touch_id: touch?.id || null,
      agent_id: agent?.id || null,
    };
    if (!body.force_new) {
      const existing = findPreparedDispatch(String(task.id), (touch?.id as string) || null);
      if (existing) {
        return {
          task: parse(db.prepare('SELECT * FROM tasks WHERE id = ?').get(String(task.id)) as Record<string, unknown>),
          touch: touch?.id ? latestTouchForTask(String(task.id)) : null,
          run: parseRun(existing),
          envelope: parseJson(existing.dispatch_payload, {}),
          reused: true,
          message: 'Existing prepared dispatch reused. No agent was launched.',
        };
      }
    }

    const envelope = buildDispatchEnvelope({
      run,
      task: parsedTask,
      touch,
      agent,
      settings: loadSettings(db),
      baseUrl: publicBaseUrl(),
      instructions,
      intent: body.intent || 'orchestrate',
    });

    db.prepare(`
    INSERT INTO runs (
      id, agent_name, worker_type, status, task_id, touch_id, agent_id,
      dispatch_status, dispatch_transport, dispatch_target, dispatch_payload, steps, logs, created_at
    ) VALUES (?, ?, ?, 'pending_dispatch', ?, ?, ?, 'prepared', ?, ?, ?, '[]', '[]', datetime('now'))
  `).run(
      runId,
      agent?.name || body.agent_name || parsedTask.owner || 'manual',
      agent?.type || null,
      task.id,
      touch?.id || null,
      agent?.id || null,
      agent?.dispatch_transport || 'manual',
      agent?.dispatch_target || null,
      stringifyJson(envelope),
    );

    if (touch?.id) {
      db.prepare(`
      UPDATE baton_touches
      SET status = 'prepared', run_id = ?, updated_at = datetime('now')
      WHERE id = ?
    `).run(runId, touch.id);
    }

    const linked = safeJsonArray(task.linked_run_ids);
    if (!linked.includes(runId)) {
      linked.push(runId);
      db.prepare(`UPDATE tasks SET linked_run_ids = ?, updated_at = datetime('now') WHERE id = ?`).run(stringifyJson(linked), task.id);
    }

    const savedRun = db.prepare('SELECT * FROM runs WHERE id = ?').get(runId);
    rebuildTouches(db);
    return {
      task: parse(db.prepare('SELECT * FROM tasks WHERE id = ?').get(String(task.id)) as Record<string, unknown>),
      touch: touch?.id ? latestTouchForTask(String(task.id)) : null,
      run: parseRun(savedRun),
      envelope,
      reused: false,
      message: 'Dispatch prepared. No agent was launched.',
    };
  }

  router.get('/', (req: Request, res: Response) => {
    try {
      const includeArchived = req.query.include_archived === 'true';
      let sql = includeArchived
        ? 'SELECT * FROM tasks WHERE 1=1'
        : "SELECT * FROM tasks WHERE status != 'archived'";
      const params: unknown[] = [];
      if (typeof req.query.status === 'string') { sql += ' AND status = ?'; params.push(req.query.status); }
      if (typeof req.query.priority === 'string') { sql += ' AND priority = ?'; params.push(req.query.priority); }
      if (typeof req.query.owner === 'string') { sql += ' AND owner = ?'; params.push(req.query.owner); }
      sql += " ORDER BY CASE priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END, created_at ASC";
      const tasks = db.prepare(sql).all(...params);
      res.json(tasks.map((row) => parse(row as Record<string, unknown>)));
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'tasks list failed' });
    }
  });

  router.get('/:id', (req: Request, res: Response) => {
    try {
      const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(req.params.id);
      if (!task) return res.status(404).json({ error: 'Not found' });
      res.json(parse(task));
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'task lookup failed' });
    }
  });

  router.post('/:id/dispatch/prepare', (req: Request, res: Response) => {
    try {
      const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(req.params.id);
      if (!task) return res.status(404).json({ error: 'Not found' });
      const result = prepareDispatch(task, (req.body || {}) as Record<string, unknown>);
      res.status(201).json(result);
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'dispatch prepare failed' });
    }
  });

  router.post('/', (req: Request, res: Response) => {
    try {
      const bodyIn = (req.body || {}) as Record<string, unknown>;
      if (!bodyIn.title) return res.status(400).json({ error: 'title is required' });
      const body = normalizeTaskBody({ ...DEFAULT_TASK, ...pick(bodyIn, ALLOWED_FIELDS) }, { partial: false });
      if ('error' in body) return res.status(400).json({ error: body.error });

      const id = randomUUID();
      const fields = ['id', ...Object.keys(body.values)];
      const placeholders = fields.map(() => '?').join(',');
      const values = [id, ...Object.values(body.values).map(sqlValue)];
      db.prepare(`INSERT INTO tasks (${fields.join(',')}) VALUES (${placeholders})`).run(...values);
      rebuildTouches(db);
      res.status(201).json(parse(db.prepare('SELECT * FROM tasks WHERE id = ?').get(id) as Record<string, unknown>));
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'task create failed' });
    }
  });

  router.patch('/:id', (req: Request, res: Response) => {
    try {
      const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(req.params.id);
      if (!task) return res.status(404).json({ error: 'Not found' });

      const body = normalizeTaskBody(pick((req.body || {}) as Record<string, unknown>, ALLOWED_FIELDS), { partial: true });
      if ('error' in body) return res.status(400).json({ error: body.error });
      const entries = Object.entries(body.values);
      if (!entries.length) return res.status(400).json({ error: 'No valid fields to update' });

      const updates = entries.map(([key]) => `${key} = ?`);
      const vals = entries.map(([, value]) => sqlValue(value));
      updates.push("updated_at = datetime('now')");
      vals.push(req.params.id);
      db.prepare(`UPDATE tasks SET ${updates.join(', ')} WHERE id = ?`).run(...vals);
      rebuildTouches(db);
      res.json(parse(db.prepare('SELECT * FROM tasks WHERE id = ?').get(req.params.id) as Record<string, unknown>));
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'task update failed' });
    }
  });

  router.delete('/:id', (req: Request, res: Response) => {
    try {
      const result = db.prepare(`
      UPDATE tasks
      SET status = 'archived', updated_at = datetime('now')
      WHERE id = ?
    `).run(req.params.id);
      if (!result.changes) return res.status(404).json({ error: 'Not found' });
      db.prepare(`
      UPDATE baton_touches
      SET status = 'archived', updated_at = datetime('now')
      WHERE task_id = ? AND status NOT IN ('resolved', 'archived')
    `).run(req.params.id);
      rebuildTouches(db);
      res.json({ archived: req.params.id });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'task archive failed' });
    }
  });

  return router;
}
