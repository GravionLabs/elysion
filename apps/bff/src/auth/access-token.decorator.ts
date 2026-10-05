import { type ExecutionContext, createParamDecorator } from '@nestjs/common';
import type { AuthenticatedRequest } from './auth.types.js';

/** The caller's bearer token, to hand on to the business backend. Only on routes behind `AuthGuard`. */
export const AccessToken = createParamDecorator(
  (_data: unknown, context: ExecutionContext): string => {
    return context.switchToHttp().getRequest<AuthenticatedRequest>().auth.token;
  },
);
