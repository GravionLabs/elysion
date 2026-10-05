import { type CryptoKey, SignJWT, createLocalJWKSet, exportJWK, generateKeyPair } from 'jose';
import { TokenVerifier } from '../src/auth/token-verifier.js';

/** What the configuration defaults to, so the test verifier and the application agree. */
export const ISSUER = 'http://localhost:8081/realms/elysion';
export const AUDIENCE = 'elysion-bff';

const { publicKey, privateKey } = await generateKeyPair('RS256');
const { privateKey: otherPrivateKey } = await generateKeyPair('RS256');
const jwk = { ...(await exportJWK(publicKey)), kid: 'test-key', alg: 'RS256', use: 'sig' };

/** A verifier that trusts the test key instead of a realm's published keys; everything else is checked as in production. */
export function testVerifier(): TokenVerifier {
  return new TokenVerifier({
    issuer: ISSUER,
    audience: AUDIENCE,
    keys: createLocalJWKSet({ keys: [jwk] }),
  });
}

export interface TokenOptions {
  subject?: string | null;
  email?: string;
  issuer?: string;
  audience?: string | null;
  /** Seconds from now until expiry; negative: already expired. */
  expiresIn?: number;
  /** Sign with a key the verifier does not know (same key id). */
  wrongKey?: boolean;
  algorithm?: 'RS256' | 'RS384';
  key?: CryptoKey;
}

/** A signed access token; the defaults are what Keycloak would issue to the dev user. */
export async function signToken(options: TokenOptions = {}): Promise<string> {
  const {
    subject = 'kc-sub-1',
    email = 'dev@elysion.local',
    issuer = ISSUER,
    audience = AUDIENCE,
  } = options;
  const expires = Math.floor(Date.now() / 1000) + (options.expiresIn ?? 300);
  const jwt = new SignJWT(email ? { email } : {})
    .setProtectedHeader({ alg: options.algorithm ?? 'RS256', kid: 'test-key' })
    .setIssuedAt(Math.min(expires - 60, Math.floor(Date.now() / 1000)))
    .setIssuer(issuer)
    .setExpirationTime(expires);
  if (subject !== null) jwt.setSubject(subject);
  if (audience !== null) jwt.setAudience(audience);
  return jwt.sign(options.key ?? (options.wrongKey ? otherPrivateKey : privateKey));
}

export const bearer = async (options?: TokenOptions) => `Bearer ${await signToken(options)}`;
