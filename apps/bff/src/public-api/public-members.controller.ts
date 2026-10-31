import {
  applyDecorators,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBody, ApiParam, ApiQuery, ApiTags } from '@nestjs/swagger';
import { AccessToken } from '../auth/access-token.decorator.js';
import { PublicApi } from '../auth/public-api.js';
import { type BoardMember, BusinessBackendClient } from '../boards/business-backend.client.js';
import { memberTarget, textField, uuidPipe as uuid } from '../boards/request-parsing.js';
import { AddMember, EXAMPLE_IDS, Member, MemberPage, MemberRole } from './dto.js';
import { type Page, paginate } from './pagination.js';
import { PublicRoute } from './public-route.js';

const MEMBER_EXAMPLE = {
  userId: EXAMPLE_IDS.USER_ID,
  displayName: 'Ada Lovelace',
  email: 'ada@example.com',
  role: 'Editor',
};

const role = (body: unknown) => textField(body, 'role', 'A member');

/** By the person's id: stable, and the backend's own order is not part of the contract. */
const membersOrder = {
  key: (member: BoardMember) => [member.userId],
  directions: ['asc'] as Array<'asc' | 'desc'>,
};

const toMember = (member: BoardMember): Member => ({
  userId: member.userId,
  displayName: member.displayName,
  email: member.email ?? null,
  role: member.role,
});

const LIST_QUERIES = [
  ApiQuery({
    name: 'cursor',
    required: false,
    description: 'The `next` of the page before.',
    schema: { type: 'string' },
  }),
  ApiQuery({
    name: 'limit',
    required: false,
    description: 'Members per page, 1 to 200.',
    schema: { type: 'integer', minimum: 1, maximum: 200, default: 50 },
  }),
];

function listDecorators(what: 'board' | 'room') {
  return [
    PublicRoute({
      scope: 'boards:read',
      summary: `List the members of a ${what}`,
      description: `Owners of the ${what} only (as in the Share dialog). Ordered by user id.`,
      status: 200,
      type: MemberPage,
      example: { items: [MEMBER_EXAMPLE], next: null },
      errors: [400, 404],
    }),
    ...LIST_QUERIES,
  ];
}

const addDecorators = (what: 'board' | 'room') => [
  PublicRoute({
    scope: 'members:write',
    summary: `Add a member to a ${what}`,
    description: `Owners only. By \`email\` or by \`userId\` (exactly one), with a role.`,
    status: 201,
    type: Member,
    example: MEMBER_EXAMPLE,
    errors: [400, 404, 409, 413],
  }),
  ApiBody({
    type: AddMember,
    examples: {
      byEmail: { value: { email: 'ada@example.com', role: 'Editor' } },
      byId: { value: { userId: EXAMPLE_IDS.USER_ID, role: 'Viewer' } },
    },
  }),
];

const changeDecorators = (what: 'board' | 'room') => [
  PublicRoute({
    scope: 'members:write',
    summary: `Change the role of a member of a ${what}`,
    description: 'Owners only. The last owner cannot become less (`409`).',
    status: 200,
    type: Member,
    example: { ...MEMBER_EXAMPLE, role: 'Viewer' },
    errors: [400, 404, 409, 413],
  }),
  ApiBody({ type: MemberRole, examples: { viewer: { value: { role: 'Viewer' } } } }),
];

const removeDecorators = (what: 'board' | 'room') => [
  PublicRoute({
    scope: 'members:write',
    summary: `Remove a member from a ${what}`,
    description: 'Owners only. The last owner cannot be removed (`409`).',
    status: 204,
    errors: [404, 409],
  }),
];

const idParam = (what: 'board' | 'room') =>
  ApiParam({
    name: 'id',
    format: 'uuid',
    example: what === 'board' ? EXAMPLE_IDS.BOARD_ID : EXAMPLE_IDS.ROOM_ID,
  });
const userParam = ApiParam({ name: 'userId', format: 'uuid', example: EXAMPLE_IDS.USER_ID });

/**
 * The members of a board on the public API (ADR 0033, #852): who may open it and as what. Passed on to the business backend with
 * the caller's own token, which allows changes to owners only and keeps its rules (the last owner, an unknown email).
 */
@PublicApi()
@ApiTags('Members')
@Controller('public/v1/boards/:id/members')
export class PublicBoardMembersController {
  constructor(private readonly backend: BusinessBackendClient) {}

  @Get()
  @applyDecorators(...listDecorators('board'), idParam('board'))
  async list(
    @AccessToken() token: string,
    @Param('id', uuid) id: string,
    @Query('cursor') cursor?: unknown,
    @Query('limit') limit?: unknown,
  ): Promise<Page<Member>> {
    const page = paginate(await this.backend.listMembers(token, id), membersOrder, {
      cursor,
      limit,
    });
    return { items: page.items.map(toMember), next: page.next };
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @applyDecorators(...addDecorators('board'), idParam('board'))
  async add(
    @AccessToken() token: string,
    @Param('id', uuid) id: string,
    @Body() body: unknown,
  ): Promise<Member> {
    return toMember(await this.backend.addMember(token, id, memberTarget(body), role(body)));
  }

  @Patch(':userId')
  @applyDecorators(...changeDecorators('board'), idParam('board'), userParam)
  async change(
    @AccessToken() token: string,
    @Param('id', uuid) id: string,
    @Param('userId', uuid) userId: string,
    @Body() body: unknown,
  ): Promise<Member> {
    return toMember(await this.backend.changeMemberRole(token, id, userId, role(body)));
  }

  @Delete(':userId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @applyDecorators(...removeDecorators('board'), idParam('board'), userParam)
  async remove(
    @AccessToken() token: string,
    @Param('id', uuid) id: string,
    @Param('userId', uuid) userId: string,
  ): Promise<void> {
    await this.backend.removeMember(token, id, userId);
  }
}

/** The members of a room on the public API: the same as a board's, on the room's member list. */
@PublicApi()
@ApiTags('Members')
@Controller('public/v1/rooms/:id/members')
export class PublicRoomMembersController {
  constructor(private readonly backend: BusinessBackendClient) {}

  @Get()
  @applyDecorators(...listDecorators('room'), idParam('room'))
  async list(
    @AccessToken() token: string,
    @Param('id', uuid) id: string,
    @Query('cursor') cursor?: unknown,
    @Query('limit') limit?: unknown,
  ): Promise<Page<Member>> {
    const page = paginate(await this.backend.listRoomMembers(token, id), membersOrder, {
      cursor,
      limit,
    });
    return { items: page.items.map(toMember), next: page.next };
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @applyDecorators(...addDecorators('room'), idParam('room'))
  async add(
    @AccessToken() token: string,
    @Param('id', uuid) id: string,
    @Body() body: unknown,
  ): Promise<Member> {
    return toMember(await this.backend.addRoomMember(token, id, memberTarget(body), role(body)));
  }

  @Patch(':userId')
  @applyDecorators(...changeDecorators('room'), idParam('room'), userParam)
  async change(
    @AccessToken() token: string,
    @Param('id', uuid) id: string,
    @Param('userId', uuid) userId: string,
    @Body() body: unknown,
  ): Promise<Member> {
    return toMember(await this.backend.changeRoomMemberRole(token, id, userId, role(body)));
  }

  @Delete(':userId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @applyDecorators(...removeDecorators('room'), idParam('room'), userParam)
  async remove(
    @AccessToken() token: string,
    @Param('id', uuid) id: string,
    @Param('userId', uuid) userId: string,
  ): Promise<void> {
    await this.backend.removeRoomMember(token, id, userId);
  }
}
