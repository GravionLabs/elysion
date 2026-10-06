import {
  INTERNAL_TOKEN_ALGORITHM,
  INTERNAL_TOKEN_AUDIENCE,
  INTERNAL_TOKEN_ISSUER,
  INTERNAL_TOKEN_TTL_SECONDS,
} from '@elysion/shared-types';
import { SignJWT } from 'jose';

/**
 * Makes the token this service presents to the business backend's internal document API (ADR 0017): HS256 with the
 * secret both services share (`INTERNAL_API_SECRET`), valid for a minute, so a recorded request is useless soon after.
 * The backend accepts it on `/internal/*` only. There is no call to anybody to get it: signing is local.
 */
export class InternalTokenSigner {
  private readonly key: Uint8Array;

  constructor(secret: string) {
    this.key = new TextEncoder().encode(secret);
  }

  /** A token that is valid from `now` for {@link INTERNAL_TOKEN_TTL_SECONDS}. */
  sign(now: Date = new Date()): Promise<string> {
    const issuedAt = Math.floor(now.getTime() / 1000);
    return new SignJWT()
      .setProtectedHeader({ alg: INTERNAL_TOKEN_ALGORITHM })
      .setIssuer(INTERNAL_TOKEN_ISSUER)
      .setAudience(INTERNAL_TOKEN_AUDIENCE)
      .setIssuedAt(issuedAt)
      .setExpirationTime(issuedAt + INTERNAL_TOKEN_TTL_SECONDS)
      .sign(this.key);
  }
}
