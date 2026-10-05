import { describe, expect, it } from 'vitest';
import { TEST_WS_TOKEN_SECRET, signWsToken } from '../../test/ws-token.js';
import { InvalidWsTokenError, WsTokenVerifier } from './ws-token-verifier.js';

const BOARD = '0197a8d2-1c3e-7a10-8000-000000000001';

describe('WsTokenVerifier', () => {
  const verifier = new WsTokenVerifier(TEST_WS_TOKEN_SECRET);
  const refused = (token: string | null | undefined) =>
    verifier.verify(token).catch((e: unknown) => e);

  it('accepts a valid token and returns its subject, board and role', async () => {
    const claims = await verifier.verify(signWsToken(BOARD, { sub: 'kc-sub-9', role: 'viewer' }));

    expect(claims).toEqual({ sub: 'kc-sub-9', boardId: BOARD, role: 'viewer' });
  });

  it.each(['owner', 'editor', 'viewer'])('accepts the role %s', async (role) => {
    expect((await verifier.verify(signWsToken(BOARD, { role }))).role).toBe(role);
  });

  it('refuses a missing token', async () => {
    for (const token of [null, undefined, '']) {
      expect(await refused(token)).toBeInstanceOf(InvalidWsTokenError);
    }
  });

  it('refuses a token signed with another secret', async () => {
    const token = signWsToken(BOARD, { secret: 'another-secret-that-is-at-least-32-characters' });

    expect(await refused(token)).toBeInstanceOf(InvalidWsTokenError);
  });

  it('refuses an expired token, and tolerates only a few seconds of clock difference', async () => {
    expect(await refused(signWsToken(BOARD, { expiresIn: -60 }))).toBeInstanceOf(
      InvalidWsTokenError,
    );
    expect(await verifier.verify(signWsToken(BOARD, { expiresIn: -2 }))).toMatchObject({
      boardId: BOARD,
    });
  });

  it('refuses another issuer and another audience', async () => {
    expect(await refused(signWsToken(BOARD, { issuer: 'someone-else' }))).toBeInstanceOf(
      InvalidWsTokenError,
    );
    expect(await refused(signWsToken(BOARD, { audience: 'elysion-bff' }))).toBeInstanceOf(
      InvalidWsTokenError,
    );
  });

  it.each(['sub', 'boardId', 'role', 'exp'] as const)(
    'refuses a token without %s',
    async (claim) => {
      expect(await refused(signWsToken(BOARD, { omit: [claim] }))).toBeInstanceOf(
        InvalidWsTokenError,
      );
    },
  );

  it('refuses a role that does not exist', async () => {
    for (const role of ['admin', 'Owner', '', 'root']) {
      expect(await refused(signWsToken(BOARD, { role }))).toBeInstanceOf(InvalidWsTokenError);
    }
  });

  it('refuses an algorithm other than HS256 (an unsigned token in particular)', async () => {
    const b64 = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');
    const exp = Math.floor(Date.now() / 1000) + 60;
    const unsigned = `${b64({ alg: 'none' })}.${b64({ sub: 'x', boardId: BOARD, role: 'owner', iss: 'elysion-bff', aud: 'elysion-realtime', exp })}.`;

    expect(await refused(unsigned)).toBeInstanceOf(InvalidWsTokenError);
    expect(await refused(signWsToken(BOARD, { algorithm: 'HS512' }))).toBeInstanceOf(
      InvalidWsTokenError,
    );
  });

  it('refuses garbage', async () => {
    for (const token of ['abc', 'a.b.c', 'eyJ.eyJ.sig']) {
      expect(await refused(token)).toBeInstanceOf(InvalidWsTokenError);
    }
  });
});
