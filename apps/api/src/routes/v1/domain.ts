import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { DomainError } from '../../domain/errors';
import { createReviewDecision } from '../../services/review-decisions';
import {
  answerDecisionRequest,
  cancelDecisionRequest,
  createDecisionRequest,
  getDecision,
  listDecisions,
} from '../../services/decision-requests';
import { createTaskBlocker, resolveTaskBlocker } from '../../services/task-blockers';
import type { DbLike } from '../../domain/types';

function asyncRoute(
  handler: (req: Request, res: Response) => unknown | Promise<unknown>
) {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve()
      .then(() => handler(req, res))
      .catch(next);
  };
}

function sendDomainError(err: unknown, res: Response): boolean {
  if (err instanceof DomainError) {
    res.status(err.status).json({
      error: err.message,
      code: err.code,
      details: err.details,
    });
    return true;
  }
  return false;
}

function routeParam(req: Request, name: string): string {
  return String(req.params[name] || '');
}

export function createV1DomainRouter(db: DbLike): Router {
  const router = Router();

  router.post(
    '/reviews/:id/decisions',
    asyncRoute((req, res) => {
      try {
        const body = (req.body || {}) as Record<string, unknown>;
        const result = createReviewDecision(db, {
          reviewPacketId: routeParam(req, 'id'),
          decision: String(body.decision || '') as 'approve' | 'request_changes' | 'reject',
          touchId: String(body.touchId || ''),
          expectedVersion:
            body.expectedVersion == null ? undefined : Number(body.expectedVersion),
          expectedTaskVersion:
            body.expectedTaskVersion == null && body.expected_task_version == null
              ? undefined
              : Number(body.expectedTaskVersion ?? body.expected_task_version),
          reason: body.reason == null ? null : String(body.reason),
          idempotencyKey: body.idempotencyKey
            ? String(body.idempotencyKey)
            : body.idempotency_key
              ? String(body.idempotency_key)
              : undefined,
          actor: body.actor ? String(body.actor) : 'operator',
        });
        res.status(result.reused ? 200 : 201).json(result);
      } catch (err) {
        if (!sendDomainError(err, res)) throw err;
      }
    })
  );

  router.get(
    '/decisions',
    asyncRoute((req, res) => {
      res.json({
        decisions: listDecisions(db, {
          status: req.query.status ? String(req.query.status) : undefined,
          taskId: req.query.taskId ? String(req.query.taskId) : undefined,
        }),
      });
    })
  );

  router.get(
    '/decisions/:id',
    asyncRoute((req, res) => {
      try {
        res.json({ decision: getDecision(db, routeParam(req, 'id')) });
      } catch (err) {
        if (!sendDomainError(err, res)) throw err;
      }
    })
  );

  router.post(
    '/decisions',
    asyncRoute((req, res) => {
      try {
        const body = (req.body || {}) as Record<string, unknown>;
        const decision = createDecisionRequest(db, {
          question: String(body.question || ''),
          taskId: body.taskId == null ? null : String(body.taskId),
          context: body.context,
          options: body.options,
          requester: body.requester ? String(body.requester) : undefined,
        });
        res.status(201).json({ decision });
      } catch (err) {
        if (!sendDomainError(err, res)) throw err;
      }
    })
  );

  router.post(
    '/decisions/:id/answer',
    asyncRoute((req, res) => {
      try {
        const body = (req.body || {}) as Record<string, unknown>;
        const decision = answerDecisionRequest(
          db,
          routeParam(req, 'id'),
          body.response,
          body.expectedVersion == null ? undefined : Number(body.expectedVersion),
          body.actor ? String(body.actor) : 'operator'
        );
        res.json({ decision });
      } catch (err) {
        if (!sendDomainError(err, res)) throw err;
      }
    })
  );

  router.post(
    '/decisions/:id/cancel',
    asyncRoute((req, res) => {
      try {
        const body = (req.body || {}) as Record<string, unknown>;
        const decision = cancelDecisionRequest(
          db,
          routeParam(req, 'id'),
          body.expectedVersion == null ? undefined : Number(body.expectedVersion),
          body.actor ? String(body.actor) : 'operator'
        );
        res.json({ decision });
      } catch (err) {
        if (!sendDomainError(err, res)) throw err;
      }
    })
  );

  router.post(
    '/tasks/:taskId/blockers',
    asyncRoute((req, res) => {
      try {
        const body = (req.body || {}) as Record<string, unknown>;
        const result = createTaskBlocker(db, {
          taskId: routeParam(req, 'taskId'),
          reasonCode: String(body.reasonCode || body.reason_code || ''),
          summary: String(body.summary || ''),
          runId: body.runId == null ? null : String(body.runId),
          questions: body.questions,
          sourcePacketId: body.sourcePacketId == null ? null : String(body.sourcePacketId),
        });
        res.status(201).json(result);
      } catch (err) {
        if (!sendDomainError(err, res)) throw err;
      }
    })
  );

  router.post(
    '/tasks/:taskId/blockers/:blockerId/resolve',
    asyncRoute((req, res) => {
      try {
        const body = (req.body || {}) as Record<string, unknown>;
        const taskId = routeParam(req, 'taskId');
        const blockerId = routeParam(req, 'blockerId');
        const blocker = db
          .prepare('SELECT task_id FROM task_blockers WHERE id = ?')
          .get(blockerId) as { task_id?: string } | undefined;
        if (!blocker) {
          res.status(404).json({ error: 'Blocker not found', code: 'not_found' });
          return;
        }
        if (String(blocker.task_id || '') !== taskId) {
          res.status(409).json({
            error: 'Blocker does not belong to task',
            code: 'conflict',
            details: { taskId, blockerId, blockerTaskId: blocker.task_id },
          });
          return;
        }
        const result = resolveTaskBlocker(db, blockerId, {
          expectedVersion:
            body.expectedVersion == null ? undefined : Number(body.expectedVersion),
          resolutionNote: body.resolutionNote == null ? null : String(body.resolutionNote),
          actor: body.actor ? String(body.actor) : 'operator',
        });
        res.json(result);
      } catch (err) {
        if (!sendDomainError(err, res)) throw err;
      }
    })
  );

  return router;
}
