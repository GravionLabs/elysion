import { Controller, Get, UnauthorizedException } from '@nestjs/common';
import { AccessToken } from '../auth/access-token.decorator.js';
import { CredentialResolver } from '../auth/credential-resolver.js';
import { PublicApi } from '../auth/public-api.js';

/** Who the caller of the public API is. */
export interface PublicMe {
  id: string;
  name: string;
  kind: 'person' | 'integration';
  /** The id of the personal access token, or `null` for a Keycloak token. */
  tokenId: string | null;
  scopes: string[];
}

/**
 * `GET /public/v1/me` (ADR 0033, #851): the one public route this change brings, to try a token. It needs no scope: any personal
 * access token, integration or person's Keycloak token that the guard let through may ask who it is. The answer is asked of the
 * business backend afresh (not the guard's cached one), so a revoked token or a deactivated owner is refused here at once. The
 * other public routes, their problem details and the OpenAPI document come with #852.
 */
@PublicApi()
@Controller('public/v1')
export class PublicMeController {
  constructor(private readonly credentials: CredentialResolver) {}

  @Get('me')
  async me(@AccessToken() token: string): Promise<PublicMe> {
    const credential = await this.credentials.resolve(token, { fresh: true });
    if (credential === null) {
      throw new UnauthorizedException();
    }
    return {
      id: credential.userId,
      name: credential.displayName,
      kind: credential.kind,
      tokenId: credential.tokenId,
      scopes: credential.scopes,
    };
  }
}
