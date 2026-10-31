import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { AccessToken } from '../auth/access-token.decorator.js';
import {
  type AccessTokenSummary,
  BusinessBackendClient,
  type CreateAccessTokenInput,
  type CreatedAccessToken,
} from './business-backend.client.js';

// An id that is not a UUID cannot exist, so it is a 404 without asking the backend.
const uuid = new ParseUUIDPipe({ errorHttpStatusCode: HttpStatus.NOT_FOUND });

/** The most scopes a request may list (there are five); more is not a token, it is a mistake. */
const MAX_SCOPES = 20;

/** The body of a new token, by shape only: a text name, a list of texts and a whole number. The backend owns the rules (400). */
function createInputFrom(body: unknown): CreateAccessTokenInput {
  const { name, scopes, expiresInDays } = (body ?? {}) as Record<string, unknown>;
  if (typeof name !== 'string') {
    throw new BadRequestException('name must be a text.');
  }
  if (
    !Array.isArray(scopes) ||
    scopes.length > MAX_SCOPES ||
    !scopes.every((scope) => typeof scope === 'string')
  ) {
    throw new BadRequestException('scopes must be a list of texts.');
  }
  if (typeof expiresInDays !== 'number' || !Number.isInteger(expiresInDays)) {
    throw new BadRequestException('expiresInDays must be a whole number.');
  }
  return { name, scopes: scopes as string[], expiresInDays };
}

/**
 * The person's personal access tokens (ADR 0033, #851) for the shell's "Access tokens" page: list, make (the answer is the one time
 * the secret is shown) and revoke. A browser route like the others: a personal access token or an integration is refused here by the
 * guard, and the backend refuses to let anything but a signed-in person manage tokens.
 */
@Controller('api/access-tokens')
export class AccessTokensController {
  constructor(private readonly backend: BusinessBackendClient) {}

  @Get()
  list(@AccessToken() token: string): Promise<AccessTokenSummary[]> {
    return this.backend.listAccessTokens(token);
  }

  @Post()
  create(@AccessToken() token: string, @Body() body: unknown): Promise<CreatedAccessToken> {
    return this.backend.createAccessToken(token, createInputFrom(body));
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  revoke(@AccessToken() token: string, @Param('id', uuid) id: string): Promise<void> {
    return this.backend.revokeAccessToken(token, id);
  }
}
