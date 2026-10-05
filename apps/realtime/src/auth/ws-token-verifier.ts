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
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'InvalidWsTokenError';
  }
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

  constructor(secret: string) {
    this.key = new TextEncoder().encode(secret);
  }

  async verify(token: string | null | undefined): Promise<WsTokenClaims> {
    if (!token) {
      throw new InvalidWsTokenError('A token is required.');
    }
    try {
      const { payload } = await jwtVerify(token, this.key, {
        issuer: WS_TOKEN_ISSUER,
        audience: WS_TOKEN_AUDIENCE,
        algorithms: [WS_TOKEN_ALGORITHM],
        clockTolerance: CLOCK_TOLERANCE_SECONDS,
        requiredClaims: ['sub', 'exp', 'boardId', 'role'],
      });
      const { sub, boardId, role } = payload as {
        sub?: unknown;
        boardId?: unknown;
        role?: unknown;
      };
      if (typeof sub !== 'string' || sub === '' || typeof boardId !== 'string' || boardId === '') {
        throw new InvalidWsTokenError('The token has no subject or board.');
      }
      if (!isBoardRole(role)) {
        throw new InvalidWsTokenError('The token has no valid role.');
      }
      return { sub, boardId, role };
    } catch (error) {
      if (error instanceof InvalidWsTokenError) throw error;
      if (error instanceof errors.JOSEError) {
        throw new InvalidWsTokenError(error.message, { cause: error });
      }
      throw error;
    }
  }
}

function isBoardRole(value: unknown): value is BoardRole {
  return typeof value === 'string' && (BOARD_ROLES as readonly string[]).includes(value);
}
