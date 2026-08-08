import type { ErrorRequestHandler, NextFunction, Request, Response } from 'express';
import { logStructured } from '../lib/log';
import type { RequestWithId } from './request-id';

export class HttpError extends Error {
  status: number;
  code: string;
  details: unknown;

  constructor(status: number, code: string, message: string, details: unknown = null) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function requestLogMiddleware(req: RequestWithId, res: Response, next: NextFunction): void {
  const started = Date.now();
  res.on('finish', () => {
    logStructured('info', 'request', {
      requestId: req.requestId || res.getHeader('x-request-id') || null,
      method: req.method,
      path: req.originalUrl || req.url,
      status: res.statusCode,
      duration_ms: Date.now() - started,
    });
  });
  next();
}

export const errorMiddleware: ErrorRequestHandler = (err, req, res, _next) => {
  const status = typeof err?.status === 'number' ? err.status : 500;
  const code = typeof err?.code === 'string' ? err.code : 'internal_error';
  const message = status >= 500 ? 'Internal server error' : String(err?.message || 'Request failed');
  const requestId = (req as RequestWithId).requestId || res.getHeader('x-request-id') || null;

  if (status >= 500) {
    logStructured('error', 'request error', {
      requestId,
      method: req.method,
      path: req.originalUrl || req.url,
      err,
      headers: {
        authorization: req.headers.authorization,
        cookie: req.headers.cookie,
      },
    });
  }

  res.status(status).json({
    ok: false,
    error: {
      code,
      message,
      request_id: requestId,
      details: status >= 500 ? null : (err?.details ?? null),
    },
  });
};
