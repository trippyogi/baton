import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { DomainError } from '../../domain/errors';
import { listAttentionTouches, getBatonTouch } from '../../repositories/baton-touches';
import {
  assignTouch,
  claimTouch,
  escalateTouch,
  markSeen,
  setRankOverride,
  snoozeTouch,
  unsnoozeTouch,
} from '../../services/touch-attention';
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

export function createV1TouchesRouter(db: DbLike): Router {
  const router = Router();

  router.get(
    '/',
    asyncRoute((req, res) => {
      const includeSnoozed = String(req.query.include_snoozed || '1') !== '0';
      const limit = Number(req.query.limit || 50);
      res.json({ touches: listAttentionTouches(db, { includeSnoozed, limit }) });
    })
  );

  router.get(
    '/:id',
    asyncRoute((req, res) => {
      try {
        res.json({ touch: getBatonTouch(db, routeParam(req, 'id')) });
      } catch (err) {
        if (!sendDomainError(err, res)) throw err;
      }
    })
  );

  router.post(
    '/:id/seen',
    asyncRoute((req, res) => {
      try {
        const body = (req.body || {}) as Record<string, unknown>;
        res.json({
          touch: markSeen(db, routeParam(req, 'id'), body.expectedVersion as number | undefined),
        });
      } catch (err) {
        if (!sendDomainError(err, res)) throw err;
      }
    })
  );

  router.post(
    '/:id/snooze',
    asyncRoute((req, res) => {
      try {
        const body = (req.body || {}) as Record<string, unknown>;
        const until = String(body.until || '');
        res.json({
          touch: snoozeTouch(
            db,
            routeParam(req, 'id'),
            until,
            body.expectedVersion as number | undefined
          ),
        });
      } catch (err) {
        if (!sendDomainError(err, res)) throw err;
      }
    })
  );

  router.post(
    '/:id/unsnooze',
    asyncRoute((req, res) => {
      try {
        const body = (req.body || {}) as Record<string, unknown>;
        res.json({
          touch: unsnoozeTouch(
            db,
            routeParam(req, 'id'),
            body.expectedVersion as number | undefined
          ),
        });
      } catch (err) {
        if (!sendDomainError(err, res)) throw err;
      }
    })
  );

  router.post(
    '/:id/assign',
    asyncRoute((req, res) => {
      try {
        const body = (req.body || {}) as Record<string, unknown>;
        res.json({
          touch: assignTouch(
            db,
            routeParam(req, 'id'),
            body.assigneeId == null ? null : String(body.assigneeId),
            body.expectedVersion as number | undefined
          ),
        });
      } catch (err) {
        if (!sendDomainError(err, res)) throw err;
      }
    })
  );

  router.post(
    '/:id/claim',
    asyncRoute((req, res) => {
      try {
        const body = (req.body || {}) as Record<string, unknown>;
        const claimantId = String(body.claimantId || body.assigneeId || 'operator');
        res.json({
          touch: claimTouch(
            db,
            routeParam(req, 'id'),
            claimantId,
            body.expectedVersion as number | undefined
          ),
        });
      } catch (err) {
        if (!sendDomainError(err, res)) throw err;
      }
    })
  );

  router.post(
    '/:id/rank-override',
    asyncRoute((req, res) => {
      try {
        const body = (req.body || {}) as Record<string, unknown>;
        const override =
          body.override == null || body.override === ''
            ? null
            : Number(body.override);
        res.json({
          touch: setRankOverride(
            db,
            routeParam(req, 'id'),
            override,
            body.expectedVersion as number | undefined
          ),
        });
      } catch (err) {
        if (!sendDomainError(err, res)) throw err;
      }
    })
  );

  router.post(
    '/:id/escalate',
    asyncRoute((req, res) => {
      try {
        const body = (req.body || {}) as Record<string, unknown>;
        res.json({
          touch: escalateTouch(
            db,
            routeParam(req, 'id'),
            body.expectedVersion as number | undefined
          ),
        });
      } catch (err) {
        if (!sendDomainError(err, res)) throw err;
      }
    })
  );

  // Explicitly reject generic resolve-via-PATCH.
  router.patch('/:id', (_req, res) => {
    res.status(405).json({
      error: 'Generic touch PATCH is forbidden; use domain commands or attention endpoints',
      code: 'method_not_allowed',
    });
  });

  return router;
}
