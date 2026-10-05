import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig } from './config.js';

describe('loadConfig', () => {
  it('reads the WS token secret', () => {
    expect(loadConfig({ WS_TOKEN_SECRET: 'x'.repeat(32) })).toEqual({
      wsTokenSecret: 'x'.repeat(32),
    });
  });

  it('fails closed without a secret, and says which variable', () => {
    for (const env of [{}, { WS_TOKEN_SECRET: '' }, { WS_TOKEN_SECRET: '   ' }]) {
      expect(() => loadConfig(env)).toThrow(ConfigError);
      expect(() => loadConfig(env)).toThrow(/WS_TOKEN_SECRET is required/);
    }
  });

  it('refuses a short secret', () => {
    expect(() => loadConfig({ WS_TOKEN_SECRET: 'short' })).toThrow(/at least 32/);
  });
});
