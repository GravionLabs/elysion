import type { Request } from 'express';
import type { AccessTokenClaims } from './token-verifier.js';

/** Set by `AuthGuard` on every request that passed it. */
export interface AuthContext {
  /** The bearer token as received, to forward to the business backend. */
  token: string;
  claims: AccessTokenClaims;
}

export type AuthenticatedRequest = Request & { auth: AuthContext };
