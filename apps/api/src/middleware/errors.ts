import type { ErrorRequestHandler } from 'express';

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

export const errorMiddleware: ErrorRequestHandler = (err, req, res, _next) => {
  const status = typeof err?.status === 'number' ? err.status : 500;
  const code = typeof err?.code === 'string' ? err.code : 'internal_error';
  const message = status >= 500 ? 'Internal server error' : String(err?.message || 'Request failed');
  const requestId = (req as { requestId?: string }).requestId || res.getHeader('x-request-id') || null;

  if (status >= 500) {
    console.error('[baton] request error', { requestId, err });
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
