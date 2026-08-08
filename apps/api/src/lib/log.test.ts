import { describe, expect, it } from 'vitest';
import { redactValue } from './log';

describe('redactValue', () => {
  it('redacts token-like keys and bearer headers', () => {
    const out = redactValue({
      authorization: 'Bearer secret-token',
      nested: { api_key: 'abc', note: 'ok' },
      message: 'Authorization: Bearer keep-me-out',
    }) as Record<string, unknown>;

    expect(out.authorization).toBe('[REDACTED]');
    expect((out.nested as Record<string, unknown>).api_key).toBe('[REDACTED]');
    expect((out.nested as Record<string, unknown>).note).toBe('ok');
    expect(out.message).toBe('Authorization: Bearer [REDACTED]');
  });
});
