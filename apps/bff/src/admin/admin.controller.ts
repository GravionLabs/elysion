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
  type AuditFilter,
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

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A date or a date and time (`2026-10-05`, `2026-10-05T12:00:00Z`, with a zone or an offset), or a 400. */
const DATE = /^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,7})?)?(?:Z|[+-]\d{2}:\d{2})?)?$/i;

/** The filters of the audit log, each checked: ids are UUIDs, dates look like dates, the page numbers are whole. */
function auditFilterFrom(query: Record<string, unknown>): AuditFilter {
  const text = (name: string, pattern: RegExp, what: string): string | undefined => {
    const value = query[name];
    if (value === undefined) return undefined;
    if (typeof value !== 'string' || !pattern.test(value)) {
      throw new BadRequestException(`${name} must be ${what}.`);
    }
    return value;
  };
  const subject = text('subject', UUID, 'an id');
  const actor = text('actor', UUID, 'an id');
  const from = text('from', DATE, 'a date');
  const to = text('to', DATE, 'a date');
  const page = whole('page', query['page'], MAX_PAGE);
  const pageSize = whole('pageSize', query['pageSize'], MAX_PAGE_SIZE);
  return {
    ...(subject === undefined ? {} : { subject }),
    ...(actor === undefined ? {} : { actor }),
    ...(from === undefined ? {} : { from }),
    ...(to === undefined ? {} : { to }),
    ...(page === undefined ? {} : { page }),
    ...(pageSize === undefined ? {} : { pageSize }),
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

  /** `?kind=person` or `?kind=integration` keeps one of the two (#851); any other value is a 400. */
  @Get('users')
  users(
    @AccessToken() token: string,
    @Query('query') query?: unknown,
    @Query('page') page?: unknown,
    @Query('pageSize') pageSize?: unknown,
    @Query('kind') kind?: unknown,
  ): Promise<unknown> {
    if (kind !== undefined && kind !== 'person' && kind !== 'integration') {
      throw new BadRequestException('kind must be person or integration.');
    }
    return this.backend.adminListUsers(token, {
      ...listFrom(query, page, pageSize),
      ...(kind === undefined ? {} : { kind }),
    });
  }

  /** Every personal access token of the instance (#851), searchable by its name, its prefix or its owner's name. */
  @Get('access-tokens')
  accessTokens(
    @AccessToken() token: string,
    @Query('query') query?: unknown,
    @Query('page') page?: unknown,
    @Query('pageSize') pageSize?: unknown,
  ): Promise<unknown> {
    return this.backend.adminListAccessTokens(token, listFrom(query, page, pageSize));
  }

  @Delete('access-tokens/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  revokeAccessToken(@AccessToken() token: string, @Param('id', uuid) id: string): Promise<void> {
    return this.backend.adminRevokeAccessToken(token, id);
  }

  @Get('users/:id')
  user(@AccessToken() token: string, @Param('id', uuid) id: string): Promise<unknown> {
    return this.backend.adminGetUser(token, id);
  }

  @Post('users/:id/deactivate')
  @HttpCode(HttpStatus.OK)
  deactivate(@AccessToken() token: string, @Param('id', uuid) id: string): Promise<unknown> {
    return this.backend.adminDeactivateUser(token, id);
  }

  @Post('users/:id/reactivate')
  @HttpCode(HttpStatus.OK)
  reactivate(@AccessToken() token: string, @Param('id', uuid) id: string): Promise<unknown> {
    return this.backend.adminReactivateUser(token, id);
  }

  /** `{ fromUserId, toUserId }`, both ids: the backend decides whether the hand-over is allowed. */
  @Post('boards/transfer')
  @HttpCode(HttpStatus.OK)
  transfer(@AccessToken() token: string, @Body() body: unknown): Promise<unknown> {
    const { fromUserId, toUserId } = (body ?? {}) as Record<string, unknown>;
    if (
      typeof fromUserId !== 'string' ||
      typeof toUserId !== 'string' ||
      !UUID.test(fromUserId) ||
      !UUID.test(toUserId)
    ) {
      throw new BadRequestException('Send fromUserId and toUserId, both ids.');
    }
    return this.backend.adminTransferOwnership(token, fromUserId, toUserId);
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

  /** The people the directory lists in the group who have not signed in yet (#667): address and name, paged. */
  @Get('groups/:id/pending')
  pending(
    @AccessToken() token: string,
    @Param('id', uuid) id: string,
    @Query('page') page?: unknown,
    @Query('pageSize') pageSize?: unknown,
  ): Promise<unknown> {
    return this.backend.adminListGroupPending(token, id, listFrom(undefined, page, pageSize));
  }

  /** Whether the Graph sync is on, when it last ran and how many people wait for their first sign-in (#667). */
  @Get('graph')
  graph(@AccessToken() token: string): Promise<unknown> {
    return this.backend.adminGraphStatus(token);
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

  @Get('audit')
  audit(@AccessToken() token: string, @Query() query: Record<string, unknown>): Promise<unknown> {
    return this.backend.adminListAudit(token, auditFilterFrom(query));
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
