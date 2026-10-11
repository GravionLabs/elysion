import { Controller, Get, Query } from '@nestjs/common';
import { AccessToken } from '../auth/access-token.decorator.js';
import { BusinessBackendClient, type Group } from './business-backend.client.js';

/**
 * Finding groups (ADR 0027): a name search for the Share dialog and the caller's own groups. Passed on with the caller's
 * token; the backend answers 400 for a search under two characters and never lists members.
 */
@Controller('api')
export class GroupsController {
  constructor(private readonly backend: BusinessBackendClient) {}

  @Get('groups')
  search(@AccessToken() token: string, @Query('query') query?: string): Promise<Group[]> {
    // `?query=` twice arrives as an array: only a single string is a search; the backend decides about its length.
    return this.backend.searchGroups(token, typeof query === 'string' ? query : '');
  }

  @Get('me/groups')
  mine(@AccessToken() token: string): Promise<Group[]> {
    return this.backend.listMyGroups(token);
  }
}
