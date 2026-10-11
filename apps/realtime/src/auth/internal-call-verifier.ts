import { errors, jwtVerify } from 'jose';

/** Who calls the realtime service's internal routes, and for whom the token is meant (ADR 0029). */
export const REALTIME_CALL_ISSUER = 'elysion-business-backend';
export const REALTIME_CALL_AUDIENCE = 'elysion-realtime';
/** The longest life a token may claim; a token that lives longer is refused, so a leaked one is useless soon. */
export const REALTIME_CALL_MAX_LIFETIME_SECONDS = 60;
const CLOCK_TOLERANCE_SECONDS = 5;

/** The call has no usable service token. */
export class InvalidInternalCallError extends Error {
  constructor(readonly reason: string) {
    super(`Internal call refused: ${reason}`);
    this.name = 'InvalidInternalCallError';
  }
}

/**
 * Verifies the service token of the business backend's calls to this service: HS256 with `INTERNAL_API_SECRET` (the key
 * ADR 0017 already shares), the backend as issuer, this service as audience (so a token made for the backend's own internal
 * API cannot be replayed here), an expiry and a lifetime of at most a minute. The comparison of the signature is jose's.
 */
export class InternalCallVerifier {
  private readonly key: Uint8Array;

  constructor(secret: string) {
    this.key = new TextEncoder().encode(secret);
  }

  /** Resolves when the `Authorization` header holds a valid token, else rejects with {@link InvalidInternalCallError}. */
  async verify(authorization: string | undefined): Promise<void> {
    const match = /^Bearer ([^\s]+)$/.exec(authorization ?? '');
    if (!match) throw new InvalidInternalCallError('missing');
    try {
      const { payload } = await jwtVerify(match[1]!, this.key, {
        algorithms: ['HS256'],
        issuer: REALTIME_CALL_ISSUER,
        audience: REALTIME_CALL_AUDIENCE,
        requiredClaims: ['exp', 'iat'],
        clockTolerance: CLOCK_TOLERANCE_SECONDS,
      });
      if (payload.exp! - payload.iat! > REALTIME_CALL_MAX_LIFETIME_SECONDS) {
        throw new InvalidInternalCallError('lifetime');
      }
    } catch (error) {
      if (error instanceof InvalidInternalCallError) throw error;
      if (error instanceof errors.JWTExpired) throw new InvalidInternalCallError('expired');
      throw new InvalidInternalCallError(
        error instanceof errors.JOSEError ? error.code : 'invalid',
      );
    }
  }
}
