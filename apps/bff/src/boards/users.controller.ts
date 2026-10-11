import { Controller, Get, Query } from '@nestjs/common';
import { AccessToken } from '../auth/access-token.decorator.js';
import { BusinessBackendClient, type DirectoryUser } from './business-backend.client.js';

/**
 * Finding people to share with (ADR 0027, #663): a name or email search for the Share dialog, passed on with the caller's
 * token. The backend answers 400 for a query under two or over a hundred characters and returns at most ten people, so the
 * directory cannot be listed.
 */
@Controller('api/users')
export class UsersController {
  constructor(private readonly backend: BusinessBackendClient) {}

  @Get()
  search(@AccessToken() token: string, @Query('query') query?: string): Promise<DirectoryUser[]> {
    // `?query=` twice arrives as an array: only a single string is a search.
    return this.backend.searchUsers(token, typeof query === 'string' ? query : '');
  }
}
