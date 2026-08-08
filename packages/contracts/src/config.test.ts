import { describe, expect, it } from 'vitest';
import { loadConfigFromEnv } from './config';

describe('loadConfigFromEnv', () => {
  it('defaults to loopback and port 4200', () => {
    const config = loadConfigFromEnv({});
    expect(config.host).toBe('127.0.0.1');
    expect(config.port).toBe(4200);
  });

  it('prefers VMC_PORT over PORT', () => {
    const config = loadConfigFromEnv({ PORT: '3000', VMC_PORT: '4201' });
    expect(config.port).toBe(4201);
  });

  it('rejects invalid ports', () => {
    expect(() => loadConfigFromEnv({ PORT: 'nope' })).toThrow(/Invalid port/);
  });
});
