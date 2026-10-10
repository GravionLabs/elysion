import {
  BOARD_ROLES,
  type BoardRole,
  type WsTokenClaims,
  WS_TOKEN_ALGORITHM,
  WS_TOKEN_AUDIENCE,
  WS_TOKEN_ISSUER,
} from '@elysion/shared-types';
import { errors, jwtVerify } from 'jose';

/** The WS token is missing, malformed, expired, signed with another key or not meant for this service. */
export class InvalidWsTokenError extends Error {
  constructor(message: string, options?: ErrorOptions & { reason?: WsTokenRejection }) {
    super(message, options);
    this.name = 'InvalidWsTokenError';
    this.reason = options?.reason ?? 'invalid';
  }

  /** Why the token was refused, in the words of the logs (ADR 0025); never the token. */
  readonly reason: WsTokenRejection;
}

export type WsTokenRejection =
  | 'missing'
  | 'expired'
  | 'wrong_issuer'
  | 'wrong_audience'
  | 'wrong_algorithm'
  | 'invalid_signature'
  | 'malformed'
  | 'missing_claim'
  | 'replayed'
  | 'invalid';

function rejectionOf(error: errors.JOSEError): WsTokenRejection {
  if (error instanceof errors.JWTExpired) return 'expired';
  if (error instanceof errors.JWTClaimValidationFailed) {
    if (error.claim === 'iss') return 'wrong_issuer';
    if (error.claim === 'aud') return 'wrong_audience';
    return 'missing_claim';
  }
  if (error instanceof errors.JOSEAlgNotAllowed) return 'wrong_algorithm';
  if (error instanceof errors.JWSSignatureVerificationFailed) return 'invalid_signature';
  if (error instanceof errors.JWSInvalid || error instanceof errors.JWTInvalid) return 'malformed';
  return 'invalid';
}

/** Remembers which tokens were used. `claim` is true the first time a `jti` is seen and false after that. */
export interface TokenReplayGuard {
  claim(jti: string, ttlSeconds: number): Promise<boolean>;
}

/** Seconds of clock difference tolerated between the BFF and this service; the token lives for a minute. */
const CLOCK_TOLERANCE_SECONDS = 5;

/**
 * Verifies the board-scoped WS token the BFF issues (docs/specs/identity.md): HS256 with the shared
 * `WS_TOKEN_SECRET`, issuer, audience, expiry, and the claims this service relies on. It is local on purpose:
 * no call to the BFF or to Keycloak, so a handshake never depends on either being reachable. Whether the token
 * is for the board that is being opened is the caller's check (`boardId` is in the result).
 */
export class WsTokenVerifier {
  private readonly key: Uint8Array;

  /**
   * @param replayGuard makes a token single-use: when given, a token with a `jti` opens one socket, ever. Without it
   * (unit tests) nothing is remembered.
   */
  constructor(
    secret: string,
    private readonly replayGuard?: TokenReplayGuard,
  ) {
    this.key = new TextEncoder().encode(secret);
  }

  async verify(token: string | null | undefined): Promise<WsTokenClaims> {
    if (!token) {
      throw new InvalidWsTokenError('A token is required.', { reason: 'missing' });
    }
    try {
      const { payload } = await jwtVerify(token, this.key, {
        issuer: WS_TOKEN_ISSUER,
        audience: WS_TOKEN_AUDIENCE,
        algorithms: [WS_TOKEN_ALGORITHM],
        clockTolerance: CLOCK_TOLERANCE_SECONDS,
        requiredClaims: ['sub', 'exp', 'boardId', 'role'],
      });
      const { sub, boardId, role, jti } = payload as {
        jti?: unknown;
        sub?: unknown;
        boardId?: unknown;
        role?: unknown;
      };
      if (typeof sub !== 'string' || sub === '' || typeof boardId !== 'string' || boardId === '') {
        throw new InvalidWsTokenError('The token has no subject or board.', {
          reason: 'missing_claim',
        });
      }
      if (!isBoardRole(role)) {
        throw new InvalidWsTokenError('The token has no valid role.', { reason: 'missing_claim' });
      }
      // A token that was stolen (it travels in a URL) opens nothing a second time. A token without a `jti` comes from a BFF
      // that predates this rule; it stays valid for its minute.
      if (this.replayGuard && typeof jti === 'string' && jti !== '') {
        const secondsLeft = (typeof payload.exp === 'number' ? payload.exp : 0) - Date.now() / 1000;
        const fresh = await this.replayGuard.claim(
          jti,
          Math.ceil(Math.max(secondsLeft, 0)) + CLOCK_TOLERANCE_SECONDS + 1,
        );
        if (!fresh) {
          throw new InvalidWsTokenError('The token was used before.', { reason: 'replayed' });
        }
      }
      return { sub, boardId, role };
    } catch (error) {
      if (error instanceof InvalidWsTokenError) throw error;
      if (error instanceof errors.JOSEError) {
        throw new InvalidWsTokenError(error.message, { cause: error, reason: rejectionOf(error) });
      }
      throw error;
    }
  }
}

function isBoardRole(value: unknown): value is BoardRole {
  return typeof value === 'string' && (BOARD_ROLES as readonly string[]).includes(value);
}
