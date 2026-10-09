import { type JWTVerifyGetKey, errors, jwtVerify } from 'jose';

/** What the BFF reads from a verified Keycloak access token. */
export interface AccessTokenClaims {
  /** The user's id at the identity provider. */
  sub: string;
  email?: string;
}

/** The token is missing, malformed, expired, signed by someone else or meant for another audience. */
export class InvalidTokenError extends Error {
  constructor(message: string, options?: ErrorOptions & { reason?: TokenRejection }) {
    super(message, options);
    this.name = 'InvalidTokenError';
    this.reason = options?.reason ?? 'invalid';
  }

  /** Why the token was refused, in the words of the logs (ADR 0025); never the token. */
  readonly reason: TokenRejection;
}

export type TokenRejection =
  | 'expired'
  | 'not_yet_valid'
  | 'wrong_issuer'
  | 'wrong_audience'
  | 'wrong_algorithm'
  | 'invalid_signature'
  | 'malformed'
  | 'missing_claim'
  | 'invalid';

/** The reason a verification failed, from jose's error class and, for a claim, the claim's name. */
export function rejectionOf(error: errors.JOSEError): TokenRejection {
  if (error instanceof errors.JWTExpired) {
    return 'expired';
  }
  if (error instanceof errors.JWTClaimValidationFailed) {
    switch (error.claim) {
      case 'iss':
        return 'wrong_issuer';
      case 'aud':
        return 'wrong_audience';
      case 'nbf':
        return 'not_yet_valid';
      default:
        return 'missing_claim';
    }
  }
  if (error instanceof errors.JOSEAlgNotAllowed) {
    return 'wrong_algorithm';
  }
  if (
    error instanceof errors.JWSSignatureVerificationFailed ||
    error instanceof errors.JWKSNoMatchingKey
  ) {
    return 'invalid_signature';
  }
  if (error instanceof errors.JWSInvalid || error instanceof errors.JWTInvalid) {
    return 'malformed';
  }
  return 'invalid';
}

export interface TokenVerifierOptions {
  /** The `iss` the tokens carry (`OIDC_ISSUER_URL`). */
  issuer: string;
  /** The `aud` a token must contain (`OIDC_AUDIENCE`). */
  audience: string;
  /** Resolves a token's signing key: the realm's remote JWKS in production, a local key set in tests. */
  keys: JWTVerifyGetKey;
}

/** Seconds of clock difference tolerated between Keycloak and this service, as in the business backend. */
const CLOCK_TOLERANCE_SECONDS = 30;

/**
 * Verifies Keycloak access tokens (docs/specs/identity.md): signature against the realm's keys, issuer,
 * audience and expiry, all explicit. It only validates; it never issues a token and never calls the business
 * backend, so a check is a key-cache hit and a signature verification.
 */
export class TokenVerifier {
  constructor(private readonly options: TokenVerifierOptions) {}

  async verify(token: string): Promise<AccessTokenClaims> {
    try {
      const { payload } = await jwtVerify(token, this.options.keys, {
        issuer: this.options.issuer,
        audience: this.options.audience,
        // Keycloak signs with RS256 by default. Naming the algorithm keeps a token from choosing a weaker one
        // (`none`, or HS256 with a public key as the secret).
        algorithms: ['RS256'],
        clockTolerance: CLOCK_TOLERANCE_SECONDS,
        requiredClaims: ['sub', 'exp'],
      });
      if (typeof payload.sub !== 'string' || payload.sub.trim() === '') {
        throw new InvalidTokenError('The token has no subject.', { reason: 'missing_claim' });
      }
      return {
        sub: payload.sub,
        ...(typeof payload.email === 'string' && payload.email !== ''
          ? { email: payload.email }
          : {}),
      };
    } catch (error) {
      if (error instanceof InvalidTokenError) {
        throw error;
      }
      if (error instanceof errors.JOSEError) {
        throw new InvalidTokenError(error.message, { cause: error, reason: rejectionOf(error) });
      }
      // Not a verdict on the token (the realm's keys could not be fetched, ...): do not report it as an invalid
      // token, the caller should see a server problem rather than be sent to log in again.
      throw error;
    }
  }
}
