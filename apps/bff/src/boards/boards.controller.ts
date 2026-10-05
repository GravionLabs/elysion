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
} from '@nestjs/common';
import { AccessToken } from '../auth/access-token.decorator.js';
import { Board, BusinessBackendClient } from './business-backend.client.js';

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

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@AccessToken() token: string, @Param('id', boardId) id: string): Promise<void> {
    await this.backend.deleteBoard(token, id);
  }
}
