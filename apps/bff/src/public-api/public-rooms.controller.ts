import { Controller, Get, NotFoundException, Param, Query } from '@nestjs/common';
import { ApiParam, ApiQuery, ApiTags } from '@nestjs/swagger';
import { AccessToken } from '../auth/access-token.decorator.js';
import { PublicApi } from '../auth/public-api.js';
import { BusinessBackendClient, type Room } from '../boards/business-backend.client.js';
import { uuidPipe as uuid } from '../boards/request-parsing.js';
import { EXAMPLE_IDS, PublicRoom, RoomPage } from './dto.js';
import { type Page, paginate, timeKey } from './pagination.js';
import { PublicRoute } from './public-route.js';

const ROOM_EXAMPLE = {
  id: EXAMPLE_IDS.ROOM_ID,
  name: 'Team Phoenix',
  createdAt: '2026-09-01T08:00:00Z',
  role: 'Editor',
};

const toPublicRoom = (room: Room): PublicRoom => ({
  id: room.id,
  name: room.name,
  createdAt: room.createdAt,
  role: room.role,
});

const roomsOrder = {
  key: (room: PublicRoom) => [timeKey(room.createdAt), room.id],
  directions: ['desc', 'asc'] as Array<'asc' | 'desc'>,
};

/**
 * Rooms on the public API (ADR 0033, #852), read-only in v1: the rooms the caller has a role in, as the business backend lists
 * them for the caller. A room the caller has no role in is `404`, also when it exists. Its boards: `GET /public/v1/boards?roomId=`.
 */
@PublicApi()
@ApiTags('Rooms')
@Controller('public/v1/rooms')
export class PublicRoomsController {
  constructor(private readonly backend: BusinessBackendClient) {}

  @Get()
  @PublicRoute({
    scope: 'boards:read',
    summary: 'List rooms',
    description:
      'The rooms the caller has a role in (directly or through a group), newest first, with that role.',
    status: 200,
    type: RoomPage,
    example: { items: [ROOM_EXAMPLE], next: null },
    errors: [400],
  })
  @ApiQuery({
    name: 'cursor',
    required: false,
    description: 'The `next` of the page before.',
    schema: { type: 'string' },
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    description: 'Rooms per page, 1 to 200.',
    schema: { type: 'integer', minimum: 1, maximum: 200, default: 50 },
  })
  async list(
    @AccessToken() token: string,
    @Query('cursor') cursor?: unknown,
    @Query('limit') limit?: unknown,
  ): Promise<Page<PublicRoom>> {
    return paginate((await this.backend.listRooms(token)).map(toPublicRoom), roomsOrder, {
      cursor,
      limit,
    });
  }

  @Get(':id')
  @PublicRoute({
    scope: 'boards:read',
    summary: 'Read a room',
    description: 'Its boards: `GET /public/v1/boards?roomId=<id>`.',
    status: 200,
    type: PublicRoom,
    example: ROOM_EXAMPLE,
    errors: [404],
  })
  @ApiParam({ name: 'id', format: 'uuid', example: EXAMPLE_IDS.ROOM_ID })
  async get(@AccessToken() token: string, @Param('id', uuid) id: string): Promise<PublicRoom> {
    const room = (await this.backend.listRooms(token)).find((candidate) => candidate.id === id);
    if (room === undefined) {
      throw new NotFoundException();
    }
    return toPublicRoom(room);
  }
}
