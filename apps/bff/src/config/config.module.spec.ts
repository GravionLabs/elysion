import { Test } from '@nestjs/testing';
import { afterEach, describe, expect, it } from 'vitest';
import { AppConfigService, ConfigModule } from './config.module.js';
import { ConfigError } from './env.js';

describe('ConfigModule', () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
  });

  it('serves typed values from the environment', async () => {
    process.env.WS_TOKEN_SECRET = 'y'.repeat(40);
    process.env.PORT = '4321';
    const module = await Test.createTestingModule({ imports: [ConfigModule] }).compile();

    const config = module.get(AppConfigService);

    expect(config.get('PORT')).toBe(4321);
    expect(config.get('WS_TOKEN_TTL_SECONDS')).toBe(60);
    expect(config.get('OIDC_AUDIENCE')).toBe('elysion-bff');
  });

  it('stops the application at startup when the environment is invalid', async () => {
    delete process.env.WS_TOKEN_SECRET;

    await expect(Test.createTestingModule({ imports: [ConfigModule] }).compile()).rejects.toThrow(
      ConfigError,
    );
  });
});
