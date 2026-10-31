import { SetMetadata, UseGuards, applyDecorators } from '@nestjs/common';
import { ApiBearerAuth } from '@nestjs/swagger';
import { PublicApiRateLimitGuard } from '../public-api/rate-limit.js';

/**
 * The scopes of the public API (ADR 0033), the same words as the business backend's `AccessTokenScopes`. A personal access token
 * has the ones it was made with, an integration the ones of its Keycloak token's `scope` claim, a person's own Keycloak token all.
 */
export const API_SCOPES = [
  'boards:read',
  'boards:write',
  'members:write',
  'snapshots:write',
  'webhooks:write',
] as const;

export type ApiScope = (typeof API_SCOPES)[number];

/** The prefix of a personal access token: such a token is accepted on the public API only. */
export const ACCESS_TOKEN_PREFIX = 'elp_';

/** The realm role of a Keycloak service account that is an integration: accepted on the public API only. */
export const INTEGRATION_ROLE = 'elysion-integration';

export const IS_PUBLIC_API = 'isPublicApi';
export const REQUIRED_SCOPE = 'requiredScope';

/**
 * Marks a controller as part of the public API (`/public/v1`, ADR 0033): its routes accept personal access tokens and integrations
 * besides a person's Keycloak token, and every other route refuses them. Put it on every controller under `/public/v1`. It also
 * puts the rate limit per credential on the routes (`PublicApiRateLimitGuard`, after the global guard) and says in the OpenAPI
 * document that they take a bearer token.
 */
export const PublicApi = () =>
  applyDecorators(
    SetMetadata(IS_PUBLIC_API, true),
    UseGuards(PublicApiRateLimitGuard),
    ApiBearerAuth(),
  );

/** The scope a public route needs; without it the caller gets `403`. A public route without it needs only a valid credential. */
export const RequireScope = (scope: ApiScope) => SetMetadata(REQUIRED_SCOPE, scope);
