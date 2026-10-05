import { SignJWT, generateKeyPair } from 'jose';
import { describe, expect, it } from 'vitest';
import { AUDIENCE, ISSUER, signToken, testVerifier } from '../../test/test-auth.js';
import { InvalidTokenError } from './token-verifier.js';

describe('TokenVerifier', () => {
  const verifier = testVerifier();
  const refused = async (token: string) => verifier.verify(token).catch((e: unknown) => e);

  it('accepts a valid token and returns its subject and email', async () => {
    const claims = await verifier.verify(await signToken());

    expect(claims).toEqual({ sub: 'kc-sub-1', email: 'dev@elysion.local' });
  });

  it('accepts a token without an email: it is optional', async () => {
    expect(await verifier.verify(await signToken({ email: '' }))).toEqual({ sub: 'kc-sub-1' });
  });

  it('refuses a token signed with another key', async () => {
    expect(await refused(await signToken({ wrongKey: true }))).toBeInstanceOf(InvalidTokenError);
  });

  it('refuses a token from another issuer', async () => {
    expect(
      await refused(await signToken({ issuer: 'http://evil.test/realms/elysion' })),
    ).toBeInstanceOf(InvalidTokenError);
  });

  it('refuses a token for another audience, and one without an audience', async () => {
    expect(await refused(await signToken({ audience: 'account' }))).toBeInstanceOf(
      InvalidTokenError,
    );
    expect(await refused(await signToken({ audience: null }))).toBeInstanceOf(InvalidTokenError);
  });

  it('refuses an expired token', async () => {
    expect(await refused(await signToken({ expiresIn: -600 }))).toBeInstanceOf(InvalidTokenError);
  });

  it('tolerates a few seconds of clock difference but not minutes', async () => {
    expect(await verifier.verify(await signToken({ expiresIn: -10 }))).toMatchObject({
      sub: 'kc-sub-1',
    });
    expect(await refused(await signToken({ expiresIn: -120 }))).toBeInstanceOf(InvalidTokenError);
  });

  it('refuses a token without a subject', async () => {
    expect(await refused(await signToken({ subject: null }))).toBeInstanceOf(InvalidTokenError);
  });

  it('refuses a token without an expiry', async () => {
    const { privateKey } = await generateKeyPair('RS256');
    const token = await new SignJWT({})
      .setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
      .setIssuer(ISSUER)
      .setAudience(AUDIENCE)
      .setSubject('x')
      .sign(privateKey);

    expect(await refused(token)).toBeInstanceOf(InvalidTokenError);
  });

  it('refuses an unsigned token (alg none)', async () => {
    const b64 = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');
    const token = `${b64({ alg: 'none' })}.${b64({ sub: 'x', iss: ISSUER, aud: AUDIENCE, exp: Math.floor(Date.now() / 1000) + 300 })}.`;

    expect(await refused(token)).toBeInstanceOf(InvalidTokenError);
  });

  it('refuses a token signed with an algorithm other than RS256', async () => {
    const { privateKey } = await generateKeyPair('RS384');

    expect(await refused(await signToken({ algorithm: 'RS384', key: privateKey }))).toBeInstanceOf(
      InvalidTokenError,
    );
  });

  it('refuses garbage', async () => {
    for (const token of ['', 'abc', 'a.b.c', 'eyJ.eyJ.sig']) {
      expect(await refused(token)).toBeInstanceOf(InvalidTokenError);
    }
  });

  it('does not call a failure to reach the realm an invalid token', async () => {
    const broken = new (verifier.constructor as new (o: object) => typeof verifier)({
      issuer: ISSUER,
      audience: AUDIENCE,
      keys: async () => {
        throw new TypeError('fetch failed');
      },
    });

    const error = await broken.verify(await signToken()).catch((e: unknown) => e);

    expect(error).not.toBeInstanceOf(InvalidTokenError);
  });
});
