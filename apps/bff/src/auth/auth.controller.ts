import { Controller, Get, HttpCode, HttpStatus, Req, Res } from '@nestjs/common';
import { AppConfigService } from '../config/config.module.js';
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
  constructor(private readonly config: AppConfigService) {}

  /**
   * Who the caller is, for the shell: the subject, the email and whether the token has the administrator role
   * (`OIDC_ADMIN_ROLE`, ADR 0027), so that the shell need not parse the token. A hint for the interface only: the business backend
   * checks the role itself on every `/api/admin` call.
   */
  @Get('me')
  me(@Req() request: AuthenticatedRequest): {
    id: string;
    email?: string;
    isAdministrator: boolean;
  } {
    const { sub, email, roles } = request.auth.claims;
    const adminRole = this.config.get('OIDC_ADMIN_ROLE');
    return {
      id: sub,
      ...(email === undefined ? {} : { email }),
      isAdministrator: adminRole !== '' && roles.includes(adminRole),
    };
  }

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
