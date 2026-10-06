import {
  INTERNAL_TOKEN_AUDIENCE,
  INTERNAL_TOKEN_ISSUER,
  INTERNAL_TOKEN_TTL_SECONDS,
} from '@elysion/shared-types';
import { decodeJwt, decodeProtectedHeader, jwtVerify } from 'jose';
import { describe, expect, it } from 'vitest';
import { InternalTokenSigner } from './internal-token-signer.js';

const SECRET = 'a-test-secret-that-is-at-least-32-characters-long';
const key = (secret: string) => new TextEncoder().encode(secret);
const NOW = new Date('2026-10-06T12:00:00Z');

describe('InternalTokenSigner', () => {
  const signer = new InternalTokenSigner(SECRET);

  it('signs a token with the claims of the contract and nothing else', async () => {
    const payload = decodeJwt(await signer.sign(NOW));

    expect(payload).toEqual({
      iss: INTERNAL_TOKEN_ISSUER,
      aud: INTERNAL_TOKEN_AUDIENCE,
      iat: NOW.getTime() / 1000,
      exp: NOW.getTime() / 1000 + INTERNAL_TOKEN_TTL_SECONDS,
    });
  });

  it('uses HS256', async () => {
    expect(decodeProtectedHeader(await signer.sign(NOW))).toEqual({ alg: 'HS256' });
  });

  it('lives for a minute', () => {
    expect(INTERNAL_TOKEN_TTL_SECONDS).toBe(60);
  });

  it('can be verified with the shared secret, and only with it', async () => {
    const token = await signer.sign();

    await expect(
      jwtVerify(token, key(SECRET), {
        issuer: INTERNAL_TOKEN_ISSUER,
        audience: INTERNAL_TOKEN_AUDIENCE,
        algorithms: ['HS256'],
      }),
    ).resolves.toBeTruthy();
    await expect(
      jwtVerify(token, key('another-secret-that-is-at-least-32-characters-long')),
    ).rejects.toThrow();
  });

  it('is expired once its minute has passed', async () => {
    const token = await signer.sign(new Date(Date.now() - 120_000));

    await expect(jwtVerify(token, key(SECRET))).rejects.toThrow(/exp/);
  });

  it('makes a fresh token each time it is asked a second apart', async () => {
    const first = await signer.sign(NOW);
    const second = await signer.sign(new Date(NOW.getTime() + 1000));

    expect(first).not.toBe(second);
  });

  it('is not the WS token: another issuer and audience, so one cannot be used as the other', async () => {
    const payload = decodeJwt(await signer.sign(NOW));

    expect(payload.iss).not.toBe('elysion-bff');
    expect(payload.aud).not.toBe('elysion-realtime');
  });
});
