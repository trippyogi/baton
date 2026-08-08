import { Router } from 'express';
import type { Request, Response } from 'express';

type Stmt = {
  all: (...params: unknown[]) => unknown[];
  get: (...params: unknown[]) => Record<string, unknown> | undefined;
  run: (params: Record<string, unknown> | unknown, ...rest: unknown[]) => unknown;
};

type DbLike = {
  prepare: (sql: string) => Stmt;
  transaction: <T>(fn: () => T) => () => T;
};

type ReviewPacketsDeps = {
  db: DbLike;
  id: (prefix: string) => string;
  stringifyJson: (value: unknown) => string;
  parseJson: <T>(raw: unknown, fallback: T) => T;
  validateReviewPacket: (packet: Record<string, unknown>) => {
    valid: boolean;
    packet_status: string;
    validator_notes: unknown;
  };
  normalizeList: (value: unknown) => unknown[];
  rebuildTouches: (db: DbLike) => unknown;
};

function normalizeText(value: unknown): string {
  return Array.isArray(value) ? value.map(String).join('\n') : String(value || '');
}

export function createReviewPacketsRouter(deps: ReviewPacketsDeps): Router {
  const {
    db, id, stringifyJson, parseJson, validateReviewPacket, normalizeList, rebuildTouches,
  } = deps;
  const router = Router();

  function parsePacket(row: Record<string, unknown>): Record<string, unknown> {
    return {
      ...row,
      evidence: parseJson(row.evidence, []),
      risks: parseJson(row.risks, []),
      open_questions: parseJson(row.open_questions, []),
      sections: parseJson(row.sections, []),
      artifacts: parseJson(row.artifacts, []),
    };
  }

  router.get('/', (req: Request, res: Response) => {
    try {
      let sql = 'SELECT * FROM review_packets WHERE 1=1';
      const params: unknown[] = [];
      if (typeof req.query.task_id === 'string') { sql += ' AND task_id = ?'; params.push(req.query.task_id); }
      if (typeof req.query.run_id === 'string') { sql += ' AND run_id = ?'; params.push(req.query.run_id); }
      if (typeof req.query.packet_status === 'string') { sql += ' AND packet_status = ?'; params.push(req.query.packet_status); }
      sql += ' ORDER BY created_at DESC, rowid DESC LIMIT ?';
      params.push(Number(req.query.limit || 50));
      res.json(db.prepare(sql).all(...params).map((row) => parsePacket(row as Record<string, unknown>)));
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'review packets list failed' });
    }
  });

  router.post('/', (req: Request, res: Response) => {
    try {
      const body = (req.body || {}) as Record<string, unknown>;
      const packet: Record<string, unknown> = {
        id: id('packet'),
        task_id: body.task_id || null,
        run_id: body.run_id || null,
        agent_id: body.agent_id || null,
        work_type: body.work_type || 'general',
        goal: body.goal || '',
        artifact_url: body.artifact_url || null,
        summary: body.summary || '',
        changes: normalizeText(body.changes ?? body.what_changed ?? ''),
        rationale: normalizeText(body.rationale ?? body.why_this_approach ?? ''),
        evidence: normalizeList(body.evidence),
        risks: normalizeList(body.risks),
        open_questions: normalizeList(body.open_questions),
        suggested_next_action: body.suggested_next_action || body.recommended_next_action || '',
        schema_version: body.schema_version || body.schema || 'baton.review_packet.v1',
        sections: normalizeList(body.sections),
        artifacts: normalizeList(body.artifacts),
        confidence_score: body.confidence_score,
        quality_score: body.quality_score,
      };

      const evidence = packet.evidence as unknown[];
      const artifacts = packet.artifacts as unknown[];
      const sections = packet.sections as unknown[];
      if (!evidence.length && artifacts.length) {
        packet.evidence = artifacts.map((a) => {
          const item = a as Record<string, unknown>;
          return item.url || item.name || item.type || 'artifact';
        });
      }
      if (!(packet.evidence as unknown[]).length && sections.length) {
        packet.evidence = sections.map((s) => {
          const item = s as Record<string, unknown>;
          return item.title || item.type || 'section';
        });
      }

      if (!packet.task_id && packet.run_id) {
        const run = db.prepare('SELECT task_id, agent_id FROM runs WHERE id = ?').get(String(packet.run_id));
        if (run) {
          packet.task_id = run.task_id || null;
          packet.agent_id = packet.agent_id || run.agent_id || null;
        }
      }

      const validation = validateReviewPacket(packet);

      if (packet.task_id) {
        const task = db.prepare('SELECT id FROM tasks WHERE id = ?').get(String(packet.task_id));
        if (!task) return res.status(400).json({ error: `unknown task_id: ${packet.task_id}` });
      }
      if (packet.run_id) {
        const run = db.prepare('SELECT id FROM runs WHERE id = ?').get(String(packet.run_id));
        if (!run) return res.status(400).json({ error: `unknown run_id: ${packet.run_id}` });
      }

      const writeTx = db.transaction(() => {
        db.prepare(`
        INSERT INTO review_packets (
          id, task_id, run_id, agent_id, work_type, goal, artifact_url, summary, changes, rationale,
          evidence, risks, open_questions, suggested_next_action, schema_version, sections, artifacts,
          confidence_score, quality_score, packet_status, validator_notes
        ) VALUES (
          @id, @task_id, @run_id, @agent_id, @work_type, @goal, @artifact_url, @summary, @changes, @rationale,
          @evidence, @risks, @open_questions, @suggested_next_action, @schema_version, @sections, @artifacts,
          @confidence_score, @quality_score, @packet_status, @validator_notes
        )
      `).run({
          ...packet,
          evidence: stringifyJson(packet.evidence),
          risks: stringifyJson(packet.risks),
          open_questions: stringifyJson(packet.open_questions),
          sections: stringifyJson(packet.sections),
          artifacts: stringifyJson(packet.artifacts),
          confidence_score: Number(packet.confidence_score ?? 0.7),
          quality_score: Number(packet.quality_score ?? 0.7),
          packet_status: validation.packet_status,
          validator_notes: validation.validator_notes,
        });

        if (packet.task_id) {
          db.prepare(`UPDATE tasks SET status = 'review', updated_at = datetime('now') WHERE id = ?`).run(packet.task_id);
        }
        if (packet.run_id) {
          db.prepare(`UPDATE runs SET status = 'review_ready', review_packet_id = ?, last_status_at = datetime('now') WHERE id = ?`).run(packet.id, packet.run_id);
          db.prepare(`UPDATE agents SET status = 'idle', current_task_id = NULL, current_run_id = NULL, updated_at = datetime('now') WHERE current_run_id = ?`).run(packet.run_id);
        }
      });
      writeTx();

      const rebuild = rebuildTouches(db);
      const saved = parsePacket(db.prepare('SELECT * FROM review_packets WHERE id = ?').get(String(packet.id)) as Record<string, unknown>);
      const touch = packet.task_id
        ? db.prepare(`SELECT * FROM flow_touches WHERE review_packet_id = ? AND status NOT IN ('archived','resolved') ORDER BY created_at DESC, rowid DESC LIMIT 1`).get(String(packet.id))
        : null;
      const reviewTouchId = validation.valid ? touch?.id || null : null;
      const refineTouchId = validation.valid ? null : touch?.id || null;

      res.status(201).json({
        packet: saved,
        valid: validation.valid,
        review_touch_id: reviewTouchId,
        refine_touch_id: refineTouchId,
        validator_notes: validation.validator_notes,
        rebuild,
      });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'review packet create failed' });
    }
  });

  return router;
}
