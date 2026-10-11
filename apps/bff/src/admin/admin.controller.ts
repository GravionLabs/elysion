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
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { AccessToken } from '../auth/access-token.decorator.js';
import {
  type AdminGroupPatch,
  type AdminList,
  BusinessBackendClient,
} from '../boards/business-backend.client.js';

// An id that is not a UUID cannot exist, so it is a 404 without asking the backend.
const uuid = new ParseUUIDPipe({ errorHttpStatusCode: HttpStatus.NOT_FOUND });

/** The longest search text passed on. */
const MAX_QUERY_LENGTH = 100;

/** The largest page number and size passed on (the backend caps the size at 100 anyway). */
const MAX_PAGE = 1_000_000;
const MAX_PAGE_SIZE = 1_000;

/** A whole number from a query value, or `undefined` when it is absent; anything else is a 400. */
function whole(name: string, value: unknown, max: number): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !/^\d{1,9}$/.test(value) || Number(value) > max) {
    throw new BadRequestException(`${name} must be a whole number.`);
  }
  return Number(value);
}

/** The three values a list takes, each checked: `query` a single string of at most 100 characters, `page` and `pageSize` whole numbers. */
function listFrom(query: unknown, page: unknown, pageSize: unknown): AdminList {
  if (query !== undefined && (typeof query !== 'string' || query.length > MAX_QUERY_LENGTH)) {
    throw new BadRequestException(
      `query must be a single text of at most ${MAX_QUERY_LENGTH} characters.`,
    );
  }
  const p = whole('page', page, MAX_PAGE);
  const size = whole('pageSize', pageSize, MAX_PAGE_SIZE);
  return {
    ...(query === undefined ? {} : { query }),
    ...(p === undefined ? {} : { page: p }),
    ...(size === undefined ? {} : { pageSize: size }),
  };
}

/** The body of a group change: a string `name` and/or an `externalId` that is a string or `null`; the backend checks the rules. */
function patchFrom(body: unknown): AdminGroupPatch {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new BadRequestException('Send a JSON object with a name and/or an externalId.');
  }
  const { name, externalId } = body as Record<string, unknown>;
  const patch: AdminGroupPatch = {};
  if (name !== undefined) {
    if (typeof name !== 'string') throw new BadRequestException('name must be a text.');
    patch.name = name;
  }
  if (externalId !== undefined) {
    if (externalId !== null && typeof externalId !== 'string') {
      throw new BadRequestException('externalId must be a text, or null to unlink the group.');
    }
    patch.externalId = externalId;
  }
  if (patch.name === undefined && patch.externalId === undefined) {
    throw new BadRequestException('Send a name and/or an externalId.');
  }
  return patch;
}

/**
 * The administration area (ADR 0027, #656): each route of the business backend's `/admin` is passed on with the caller's own token, one
 * handler per call, so that the BFF builds every backend address from a fixed path, ids that passed the UUID check and a query made of
 * a short text and two numbers. The BFF holds no rule of its own: the backend checks the administrator role on every call (`403`
 * otherwise) and decides everything else; its status and body come back as they are.
 */
@Controller('api/admin')
export class AdminController {
  constructor(private readonly backend: BusinessBackendClient) {}

  @Get('stats')
  stats(@AccessToken() token: string): Promise<unknown> {
    return this.backend.adminStats(token);
  }

  @Get('users')
  users(
    @AccessToken() token: string,
    @Query('query') query?: unknown,
    @Query('page') page?: unknown,
    @Query('pageSize') pageSize?: unknown,
  ): Promise<unknown> {
    return this.backend.adminListUsers(token, listFrom(query, page, pageSize));
  }

  @Get('users/:id')
  user(@AccessToken() token: string, @Param('id', uuid) id: string): Promise<unknown> {
    return this.backend.adminGetUser(token, id);
  }

  @Get('groups')
  groups(
    @AccessToken() token: string,
    @Query('query') query?: unknown,
    @Query('page') page?: unknown,
    @Query('pageSize') pageSize?: unknown,
  ): Promise<unknown> {
    return this.backend.adminListGroups(token, listFrom(query, page, pageSize));
  }

  @Post('groups')
  createGroup(@AccessToken() token: string, @Body() body: unknown): Promise<unknown> {
    const name = (body as { name?: unknown } | null)?.name;
    if (typeof name !== 'string') {
      throw new BadRequestException('A group needs a name.');
    }
    return this.backend.adminCreateGroup(token, name);
  }

  @Patch('groups/:id')
  patchGroup(
    @AccessToken() token: string,
    @Param('id', uuid) id: string,
    @Body() body: unknown,
  ): Promise<unknown> {
    return this.backend.adminPatchGroup(token, id, patchFrom(body));
  }

  @Delete('groups/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteGroup(@AccessToken() token: string, @Param('id', uuid) id: string): Promise<void> {
    await this.backend.adminDeleteGroup(token, id);
  }

  @Get('groups/:id/members')
  members(
    @AccessToken() token: string,
    @Param('id', uuid) id: string,
    @Query('page') page?: unknown,
    @Query('pageSize') pageSize?: unknown,
  ): Promise<unknown> {
    return this.backend.adminListGroupMembers(token, id, listFrom(undefined, page, pageSize));
  }

  @Put('groups/:id/members/:userId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async addMember(
    @AccessToken() token: string,
    @Param('id', uuid) id: string,
    @Param('userId', uuid) userId: string,
  ): Promise<void> {
    await this.backend.adminAddGroupMember(token, id, userId);
  }

  @Delete('groups/:id/members/:userId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async removeMember(
    @AccessToken() token: string,
    @Param('id', uuid) id: string,
    @Param('userId', uuid) userId: string,
  ): Promise<void> {
    await this.backend.adminRemoveGroupMember(token, id, userId);
  }

  @Get('rooms')
  rooms(
    @AccessToken() token: string,
    @Query('query') query?: unknown,
    @Query('page') page?: unknown,
    @Query('pageSize') pageSize?: unknown,
  ): Promise<unknown> {
    return this.backend.adminListRooms(token, listFrom(query, page, pageSize));
  }
}
