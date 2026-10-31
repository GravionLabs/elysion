import type { Request } from 'express';
import type { Credential } from './credential-resolver.js';
import type { AccessTokenClaims } from './token-verifier.js';

/** Set by `AuthGuard` on every request that passed it. */
export interface AuthContext {
  /** The bearer token as received, to forward to the business backend. */
  token: string;
  /** A Keycloak token's claims; for a personal access token, `sub` is the owner's id in Elysion and there are no roles. */
  claims: AccessTokenClaims;
  /** On the public API only (ADR 0033): who the credential is and its scopes, as the business backend resolved it. */
  credential?: Credential;
}

export type AuthenticatedRequest = Request & { auth: AuthContext };
