import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
} from '@nestjs/common';
import type { BoardRole } from '@elysion/shared-types';
import { AccessToken } from '../auth/access-token.decorator.js';
import { Board, BusinessBackendClient } from './business-backend.client.js';
import { isUuid } from './request-parsing.js';

/** A board as the UI wants it: the backend's fields plus the route that opens it. */
export interface BoardResponse extends Board {
  path: string;
}

// An id that is not a UUID cannot exist, so it is a 404 without asking the backend.
const boardId = new ParseUUIDPipe({ errorHttpStatusCode: HttpStatus.NOT_FOUND });

function toResponse(board: Board): BoardResponse {
  return { ...board, path: `/board/${board.id}` };
}

/** The name lives in the body; its length rules belong to the business backend, which answers 400. */
function nameFrom(body: unknown): string {
  const name = (body as { name?: unknown } | null)?.name;
  if (typeof name !== 'string') {
    throw new BadRequestException('A board needs a name.');
  }
  return name;
}

@Controller('api/boards')
export class BoardsController {
  constructor(private readonly backend: BusinessBackendClient) {}

  @Get()
  async list(@AccessToken() token: string): Promise<BoardResponse[]> {
    return (await this.backend.listBoards(token)).map(toResponse);
  }

  @Get(':id')
  async get(
    @AccessToken() token: string,
    @Param('id', boardId) id: string,
  ): Promise<BoardResponse> {
    return toResponse(await this.backend.getBoard(token, id));
  }

  /**
   * What the caller may do on a board (`owner`, `editor` or `viewer`), for the shell to decide what to show: Share
   * for owners, a read-only canvas for viewers. 404 without a role, like every board route. Only a hint for the
   * interface: the backend and the realtime service enforce it.
   */
  @Get(':id/membership/me')
  async membership(
    @AccessToken() token: string,
    @Param('id', boardId) id: string,
  ): Promise<{ boardId: string; role: BoardRole }> {
    const role = await this.backend.getMyRole(token, id);
    if (role === null) {
      throw new NotFoundException();
    }
    return { boardId: id, role };
  }

  @Post()
  async create(@AccessToken() token: string, @Body() body: unknown): Promise<BoardResponse> {
    return toResponse(await this.backend.createBoard(token, nameFrom(body)));
  }

  @Patch(':id')
  async rename(
    @AccessToken() token: string,
    @Param('id', boardId) id: string,
    @Body() body: unknown,
  ): Promise<BoardResponse> {
    return toResponse(await this.backend.renameBoard(token, id, nameFrom(body)));
  }

  @Post(':id/duplicate')
  async duplicate(
    @AccessToken() token: string,
    @Param('id', boardId) id: string,
  ): Promise<BoardResponse> {
    return toResponse(await this.backend.duplicateBoard(token, id));
  }

  /**
   * Puts the board in a room, or takes it out (`{ "roomId": null }`): the backend needs write access on the board
   * and Editor in the room (404 for a room the caller has no role in, 403 for a viewer).
   */
  @Put(':id/room')
  async move(
    @AccessToken() token: string,
    @Param('id', boardId) id: string,
    @Body() body: unknown,
  ): Promise<BoardResponse> {
    const roomId = (body as { roomId?: unknown } | null)?.roomId;
    if (roomId !== null && typeof roomId !== 'string') {
      throw new BadRequestException('Say which room, or null to take the board out of its room.');
    }
    if (roomId !== null && !isUuid(roomId)) {
      throw new NotFoundException('The room does not exist.');
    }
    return toResponse(await this.backend.moveBoard(token, id, roomId));
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@AccessToken() token: string, @Param('id', boardId) id: string): Promise<void> {
    await this.backend.deleteBoard(token, id);
  }
}
