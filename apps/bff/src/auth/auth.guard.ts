import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Response } from 'express';
import type { AuthenticatedRequest } from './auth.types.js';
import { CredentialResolver } from './credential-resolver.js';
import {
  ACCESS_TOKEN_PREFIX,
  type ApiScope,
  INTEGRATION_ROLE,
  IS_PUBLIC_API,
  REQUIRED_SCOPE,
} from './public-api.js';
import { IS_PUBLIC } from './public.decorator.js';
import { InvalidTokenError, TokenVerifier } from './token-verifier.js';

/**
 * Global guard: every route needs a valid Keycloak access token unless it says `@Public()`. On success the
 * token and its claims are on `request.auth`.
 *
 * The public API (`@PublicApi()` controllers under `/public/v1`, ADR 0033) also takes a personal access token (`elp_...`) and an
 * integration's Keycloak token; every other route refuses both (`401` for a personal access token, `403` for an integration).
 * There the credential is resolved by the business backend (cached for 30 s, `CredentialResolver`) to its user and scopes, and a
 * route that needs a scope (`@RequireScope`) refuses a credential without it (`403`).
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly verifier: TokenVerifier,
    private readonly credentials: CredentialResolver,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets)) {
      return true;
    }
    const publicApi = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_API, targets) === true;

    const http = context.switchToHttp();
    const request = http.getRequest<AuthenticatedRequest>();
    const response = http.getResponse<Response>();
    const token = bearerToken(request.headers.authorization);
    if (token === null) {
      throw this.unauthorized(response);
    }

    if (token.startsWith(ACCESS_TOKEN_PREFIX)) {
      if (!publicApi) {
        // A personal access token is for scripts on the public API, never for the browser's routes.
        request.log?.warn({ reason: 'access_token_not_accepted' }, 'Access token rejected');
        throw this.unauthorized(response);
      }
      const credential = await this.credentials.resolve(token);
      if (credential === null) {
        request.log?.warn({ reason: 'access_token_refused' }, 'Access token rejected');
        throw this.unauthorized(response);
      }
      request.auth = { token, claims: { sub: credential.userId, roles: [] }, credential };
    } else {
      try {
        request.auth = { token, claims: await this.verifier.verify(token) };
      } catch (error) {
        if (error instanceof InvalidTokenError) {
          // The reason, never the token or the library's message.
          request.log?.warn({ reason: error.reason }, 'Access token rejected');
          throw this.unauthorized(response);
        }
        throw error;
      }
      if (!publicApi && request.auth.claims.roles.includes(INTEGRATION_ROLE)) {
        request.log?.warn({ reason: 'integration_not_accepted' }, 'Access token rejected');
        throw new ForbiddenException('An integration may call the public API only (/public/v1).');
      }
      if (publicApi) {
        const credential = await this.credentials.resolve(token);
        if (credential === null) {
          throw this.unauthorized(response);
        }
        request.auth.credential = credential;
      }
    }

    // From here on every log line of the request, also its final one, says whose request it was (ADR 0025), and with which
    // personal access token (its id, never the token).
    const tokenId = request.auth.credential?.tokenId;
    request.log?.setBindings({
      userId: request.auth.claims.sub,
      ...(tokenId ? { tokenId } : {}),
    });

    const scope = this.reflector.getAllAndOverride<ApiScope | undefined>(REQUIRED_SCOPE, targets);
    if (publicApi && scope !== undefined && !request.auth.credential?.scopes.includes(scope)) {
      throw new ForbiddenException(`This needs a token with the scope "${scope}".`);
    }
    return true;
  }

  private unauthorized(response: Response): UnauthorizedException {
    response.setHeader('WWW-Authenticate', 'Bearer');
    return new UnauthorizedException();
  }
}

/** The token of an `Authorization: Bearer <token>` header, or null for anything else. */
export function bearerToken(header: string | undefined): string | null {
  const match = /^Bearer +(\S+)$/i.exec(header ?? '');
  return match ? match[1] : null;
}
