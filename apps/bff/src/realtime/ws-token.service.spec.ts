import { WS_TOKEN_AUDIENCE, WS_TOKEN_ISSUER } from '@elysion/shared-types';
import { decodeJwt, decodeProtectedHeader, jwtVerify } from 'jose';
import { describe, expect, it } from 'vitest';
import type { AppConfigService } from '../config/config.module.js';
import type { AppConfig } from '../config/env.js';
import { WsTokenService } from './ws-token.service.js';

const SECRET = 'a-test-secret-that-is-at-least-32-characters-long';
const key = (secret: string) => new TextEncoder().encode(secret);

function serviceWith(overrides: Partial<AppConfig> = {}): WsTokenService {
  const values = { WS_TOKEN_SECRET: SECRET, WS_TOKEN_TTL_SECONDS: 60, ...overrides } as AppConfig;
  return new WsTokenService({ get: (name: keyof AppConfig) => values[name] } as AppConfigService);
}

const claims = {
  sub: 'kc-sub-1',
  boardId: '0197a8d2-1c3e-7a10-8000-000000000001',
  role: 'editor',
} as const;
const NOW = new Date('2026-10-05T12:00:00Z');

describe('WsTokenService', () => {
  it('signs a token with the claims of the contract', async () => {
    const { token } = await serviceWith().issue(claims, NOW);

    const payload = decodeJwt(token);
    expect(payload).toEqual({
      sub: 'kc-sub-1',
      boardId: claims.boardId,
      role: 'editor',
      iss: WS_TOKEN_ISSUER,
      aud: WS_TOKEN_AUDIENCE,
      iat: NOW.getTime() / 1000,
      exp: NOW.getTime() / 1000 + 60,
    });
  });

  it('uses HS256', async () => {
    const { token } = await serviceWith().issue(claims, NOW);

    expect(decodeProtectedHeader(token)).toEqual({ alg: 'HS256' });
  });

  it('lasts for WS_TOKEN_TTL_SECONDS and says when it ends', async () => {
    const response = await serviceWith({ WS_TOKEN_TTL_SECONDS: 30 }).issue(claims, NOW);

    expect(decodeJwt(response.token).exp).toBe(NOW.getTime() / 1000 + 30);
    expect(response.expiresAt).toBe('2026-10-05T12:00:30.000Z');
  });

  it('can be verified with the shared secret, and only with it', async () => {
    const { token } = await serviceWith().issue(claims);

    const verified = await jwtVerify(token, key(SECRET), {
      issuer: WS_TOKEN_ISSUER,
      audience: WS_TOKEN_AUDIENCE,
      algorithms: ['HS256'],
    });
    expect(verified.payload).toMatchObject({
      boardId: claims.boardId,
      role: 'editor',
      sub: 'kc-sub-1',
    });
    await expect(
      jwtVerify(token, key('another-secret-that-is-also-32-characters-long')),
    ).rejects.toThrow();
  });

  it('is already expired once its lifetime has passed', async () => {
    const { token } = await serviceWith({ WS_TOKEN_TTL_SECONDS: 1 }).issue(
      claims,
      new Date(Date.now() - 120_000),
    );

    await expect(jwtVerify(token, key(SECRET))).rejects.toThrow(/exp/);
  });

  it('carries the role it was given, one board and nothing else', async () => {
    for (const role of ['owner', 'editor', 'viewer'] as const) {
      const { token } = await serviceWith().issue({ ...claims, role }, NOW);
      expect(decodeJwt(token)).toMatchObject({ role, boardId: claims.boardId });
      expect(Object.keys(decodeJwt(token)).sort()).toEqual([
        'aud',
        'boardId',
        'exp',
        'iat',
        'iss',
        'role',
        'sub',
      ]);
    }
  });
});
