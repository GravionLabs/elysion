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
  async list(): Promise<BoardResponse[]> {
    return (await this.backend.listBoards()).map(toResponse);
  }

  @Get(':id')
  async get(@Param('id', boardId) id: string): Promise<BoardResponse> {
    return toResponse(await this.backend.getBoard(id));
  }

  @Post()
  async create(@Body() body: unknown): Promise<BoardResponse> {
    return toResponse(await this.backend.createBoard(nameFrom(body)));
  }

  @Patch(':id')
  async rename(@Param('id', boardId) id: string, @Body() body: unknown): Promise<BoardResponse> {
    return toResponse(await this.backend.renameBoard(id, nameFrom(body)));
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Param('id', boardId) id: string): Promise<void> {
    await this.backend.deleteBoard(id);
  }
}
