import { SignJWT } from 'jose';
import {
  InternalCallVerifier,
  InvalidInternalCallError,
  REALTIME_CALL_AUDIENCE,
  REALTIME_CALL_ISSUER,
} from './internal-call-verifier.js';

const SECRET = 'a-secret-of-at-least-thirty-two-characters!';
const key = new TextEncoder().encode(SECRET);
const now = Math.floor(Date.now() / 1000);

function token(
  claims: { iss?: string; aud?: string; iat?: number; exp?: number } = {},
  secret = key,
  alg = 'HS256',
) {
  const jwt = new SignJWT().setProtectedHeader({ alg });
  jwt.setIssuer(claims.iss ?? REALTIME_CALL_ISSUER);
  jwt.setAudience(claims.aud ?? REALTIME_CALL_AUDIENCE);
  jwt.setIssuedAt(claims.iat ?? now);
  jwt.setExpirationTime(claims.exp ?? now + 60);
  return jwt.sign(secret);
}

describe('InternalCallVerifier', () => {
  const verifier = new InternalCallVerifier(SECRET);
  const rejects = async (header: string | undefined) =>
    expect(verifier.verify(header)).rejects.toBeInstanceOf(InvalidInternalCallError);

  it('accepts a fresh token of the backend meant for this service', async () => {
    await expect(verifier.verify(`Bearer ${await token()}`)).resolves.toBeUndefined();
  });

  it('refuses a missing or malformed header', async () => {
    await rejects(undefined);
    await rejects('');
    await rejects('Basic abc');
    await rejects('Bearer not-a-jwt');
  });

  it('refuses an expired token', async () => {
    await rejects(`Bearer ${await token({ iat: now - 300, exp: now - 120 })}`);
  });

  it('refuses a token for another audience or from another issuer', async () => {
    await rejects(`Bearer ${await token({ aud: 'elysion-backend-internal' })}`);
    await rejects(`Bearer ${await token({ iss: 'elysion-realtime' })}`);
  });

  it('refuses a token signed with another key', async () => {
    await rejects(
      `Bearer ${await token({}, new TextEncoder().encode('another-secret-of-thirty-two-chars-or-more'))}`,
    );
  });

  it('refuses a token that lives longer than a minute', async () => {
    await rejects(`Bearer ${await token({ iat: now, exp: now + 3600 })}`);
  });
});
