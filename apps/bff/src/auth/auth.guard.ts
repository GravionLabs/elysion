import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Response } from 'express';
import type { AuthenticatedRequest } from './auth.types.js';
import { IS_PUBLIC } from './public.decorator.js';
import { InvalidTokenError, TokenVerifier } from './token-verifier.js';

/**
 * Global guard: every route needs a valid Keycloak access token unless it says `@Public()`. On success the
 * token and its claims are on `request.auth`.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly verifier: TokenVerifier,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }

    const http = context.switchToHttp();
    const request = http.getRequest<AuthenticatedRequest>();
    const token = bearerToken(request.headers.authorization);
    if (token === null) {
      throw this.unauthorized(http.getResponse<Response>());
    }
    try {
      request.auth = { token, claims: await this.verifier.verify(token) };
      return true;
    } catch (error) {
      if (error instanceof InvalidTokenError) {
        throw this.unauthorized(http.getResponse<Response>());
      }
      throw error;
    }
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
