import { Controller, Get, HttpCode, HttpStatus, Req, Res } from '@nestjs/common';
import type { Response } from 'express';
import type { AuthenticatedRequest } from './auth.types.js';

/**
 * The endpoint Traefik's forwardAuth middleware calls for every protected request (#8; Traefik's open-source
 * edition has no JWT middleware of its own). The global guard has already verified the token, so reaching
 * the handler means 200; the identity goes back in headers for the services behind the edge. It is cheap on
 * purpose: a cached key and a signature check, no call to the business backend.
 */
@Controller('api/auth')
export class AuthController {
  @Get('verify')
  @HttpCode(HttpStatus.OK)
  verify(
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) response: Response,
  ): void {
    const { sub, email } = request.auth.claims;
    response.setHeader('X-Auth-User-Id', sub);
    if (email !== undefined) {
      response.setHeader('X-Auth-User-Email', email);
    }
  }
}
