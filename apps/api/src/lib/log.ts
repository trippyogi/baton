const REDACT_KEYS = new Set([
  'authorization',
  'cookie',
  'set-cookie',
  'password',
  'passwd',
  'secret',
  'token',
  'access_token',
  'refresh_token',
  'api_key',
  'apikey',
  'apitoken',
  'baton_api_token',
  'github_webhook_secret',
  'github_worker_token',
  'shared_requests_token',
  'meta_graph_token',
]);

const REDACTED = '[REDACTED]';

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Error) && !(value instanceof Buffer);
}

export function redactValue(value: unknown, depth = 0): unknown {
  if (depth > 6) return '[Truncated]';
  if (value == null) return value;
  if (typeof value === 'string') {
    if (/bearer\s+\S+/i.test(value)) return value.replace(/bearer\s+\S+/ig, 'Bearer [REDACTED]');
    return value;
  }
  if (Array.isArray(value)) return value.map((item) => redactValue(item, depth + 1));
  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      stack: value.stack,
    };
  }
  if (!isPlainObject(value)) return value;

  const out: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    if (REDACT_KEYS.has(key.toLowerCase().replace(/[^a-z0-9_]/g, '_'))) {
      out[key] = REDACTED;
    } else {
      out[key] = redactValue(child, depth + 1);
    }
  }
  return out;
}

export type LogLevel = 'info' | 'warn' | 'error';

export function logStructured(
  level: LogLevel,
  message: string,
  fields: Record<string, unknown> = {},
): void {
  const payload = {
    ts: new Date().toISOString(),
    level,
    msg: message,
    ...(redactValue(fields) as Record<string, unknown>),
  };
  const line = JSON.stringify(payload);
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
}
