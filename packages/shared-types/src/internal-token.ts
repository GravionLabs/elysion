/**
 * The service token the realtime service presents to the business backend's internal document API
 * (ADR 0017): a short-lived JWT signed with the secret both services share, which only `/internal/*` accepts.
 * The backend (C#) repeats these values in `InternalApiOptions`; change them in both places.
 */

/** HS256 with `INTERNAL_API_SECRET`; never the same secret as the WS token's. */
export const INTERNAL_TOKEN_ALGORITHM = 'HS256';

/** The token's `iss`: issued by the realtime service. */
export const INTERNAL_TOKEN_ISSUER = 'elysion-realtime';

/** The token's `aud`: meant for the business backend's internal API. */
export const INTERNAL_TOKEN_AUDIENCE = 'elysion-backend-internal';

/** How long one token is valid, in seconds. */
export const INTERNAL_TOKEN_TTL_SECONDS = 60;
