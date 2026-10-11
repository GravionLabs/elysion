/**
 * The WS token: the short-lived, board-scoped credential the BFF hands to a signed-in user and the realtime
 * service checks at the `/yjs` handshake (docs/specs/identity.md). Both sides import this file, so the contract
 * cannot drift between them.
 */

/** What a member may do on a board, as carried in the token. */
export const BOARD_ROLES = ['owner', 'editor', 'viewer'] as const;
export type BoardRole = (typeof BOARD_ROLES)[number];

/** HS256 with `WS_TOKEN_SECRET`, shared by the BFF (signs) and the realtime service (verifies). */
export const WS_TOKEN_ALGORITHM = 'HS256';

/** The token's `iss`: issued by the BFF. */
export const WS_TOKEN_ISSUER = 'elysion-bff';

/** The token's `aud`: meant for the realtime service. */
export const WS_TOKEN_AUDIENCE = 'elysion-realtime';

/** Lifetime when `WS_TOKEN_TTL_SECONDS` is not set. */
export const DEFAULT_WS_TOKEN_TTL_SECONDS = 60;

/** Close codes of the `/yjs` socket when the handshake is refused. */
export const WS_CLOSE_UNAUTHORIZED = 4401;
export const WS_CLOSE_FORBIDDEN = 4403;
/**
 * The client's copy of the board belongs to an older generation of the document (the document was rebuilt while the
 * client was away, ADR 0026): it must throw its `Y.Doc` away and connect again instead of merging it in.
 */
export const WS_CLOSE_STALE_COPY = 4409;

/** The claims we put into the token, besides the registered `iss`, `aud`, `iat` and `exp`. */
export interface WsTokenClaims {
  /** The user's id at the identity provider (the access token's `sub`). */
  sub: string;
  /** The one board the token opens: exactly the id used in `?board=`. */
  boardId: string;
  /** The role the business backend gave the user on that board; a viewer is read-only. */
  role: BoardRole;
}

/** The answer of `POST /api/realtime/token`. */
export interface WsTokenResponse {
  token: string;
  /** When the token expires, ISO 8601 (UTC). The client asks again on every (re)connect. */
  expiresAt: string;
}
