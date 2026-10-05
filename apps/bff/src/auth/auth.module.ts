import { Global, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { createRemoteJWKSet } from 'jose';
import { AppConfigService } from '../config/config.module.js';
import { AuthController } from './auth.controller.js';
import { AuthGuard } from './auth.guard.js';
import { TokenVerifier } from './token-verifier.js';

/** Where Keycloak publishes a realm's signing keys, relative to the issuer. */
const KEYCLOAK_JWKS_PATH = '/protocol/openid-connect/certs';

/**
 * Keycloak access tokens as the way in (docs/specs/identity.md): a verifier, a guard on every route and the
 * verify endpoint for the edge. The realm's keys are fetched on first use, cached, and fetched again when a
 * token names a key that is not cached (rotation), by `jose`.
 */
@Global()
@Module({
  controllers: [AuthController],
  providers: [
    {
      provide: TokenVerifier,
      inject: [AppConfigService],
      useFactory: (config: AppConfigService) => {
        const issuer = config.get('OIDC_ISSUER_URL');
        // Inside compose the issuer (localhost:8081) is not reachable: OIDC_JWKS_URI names the keys' real address.
        const jwksUri = config.get('OIDC_JWKS_URI') ?? `${issuer}${KEYCLOAK_JWKS_PATH}`;
        return new TokenVerifier({
          issuer,
          audience: config.get('OIDC_AUDIENCE'),
          keys: createRemoteJWKSet(new URL(jwksUri), { timeoutDuration: 5000 }),
        });
      },
    },
    { provide: APP_GUARD, useClass: AuthGuard },
  ],
  exports: [TokenVerifier],
})
export class AuthModule {}
