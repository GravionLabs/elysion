import { createHash } from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  HttpException,
  HttpStatus,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import { ApiBody, ApiExtraModels, ApiHeader, ApiParam, ApiQuery, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { AccessToken } from '../auth/access-token.decorator.js';
import { PublicApi } from '../auth/public-api.js';
import { type Board, BusinessBackendClient } from '../boards/business-backend.client.js';
import { isUuid, uuidPipe as uuid } from '../boards/request-parsing.js';
import { BoardName, BoardPage, EXAMPLE_IDS, PublicBoard, Scene, SceneFile } from './dto.js';
import { type Page, paginate, timeKey } from './pagination.js';
import { PublicRoute } from './public-route.js';
import { type Scene as SceneShape, emptyScene, sceneOf } from './scene.js';

export const PUBLIC_PREFIX = '/public/v1';

const BOARD_EXAMPLE = {
  id: EXAMPLE_IDS.BOARD_ID,
  name: 'Sprint 42 retro',
  createdAt: '2026-10-31T09:15:00Z',
  roomId: null,
};

/** The fields of a board the public API shows: not the caller's own state (favorite, last opened) or the preview picture. */
export function toPublicBoard(board: Board): PublicBoard {
  return {
    id: board.id,
    name: board.name,
    createdAt: board.createdAt,
    roomId: board.roomId ?? null,
  };
}

/** The `ETag` of a board: changes when its name or room does. Quoted, strong. */
export function boardEtag(board: Board): string {
  const hash = createHash('sha256')
    .update(JSON.stringify([board.id, board.name, board.roomId ?? null]))
    .digest('base64url');
  return `"${hash.slice(0, 27)}"`;
}

/** Whether an `If-Match` header names this `ETag` (one of a list, `*` for any; a weak one never matches, RFC 9110). */
export function ifMatchAccepts(header: string, etag: string): boolean {
  return header
    .split(',')
    .map((value) => value.trim())
    .some((value) => value === '*' || value === etag);
}

/** The name in a JSON body; its rules (1 to 120 characters) are the business backend's, which answers 400. */
function nameFrom(body: unknown): string {
  const name = (body as { name?: unknown } | null)?.name;
  if (typeof name !== 'string') {
    throw new BadRequestException('A board needs a name, as text.');
  }
  return name;
}

/** A file id as Excalidraw makes them (a hash or a nanoid); anything else cannot exist and never reaches the backend. */
const FILE_ID = /^[A-Za-z0-9_-]{1,128}$/;

const boardsOrder = {
  key: (board: PublicBoard) => [timeKey(board.createdAt), board.id],
  directions: ['desc', 'asc'] as Array<'asc' | 'desc'>,
};

/**
 * Boards on the public API (ADR 0033, #852): list, read, create, rename (with `ETag` and `If-Match`), delete, duplicate, and the
 * elements and files of a board, read-only. Every call is passed on to the business backend with the caller's own token, which
 * decides as for the browser: a token acts as its owner and never sees more.
 */
@PublicApi()
@ApiTags('Boards')
@ApiExtraModels(SceneFile)
@Controller('public/v1/boards')
export class PublicBoardsController {
  constructor(private readonly backend: BusinessBackendClient) {}

  @Get()
  @PublicRoute({
    scope: 'boards:read',
    summary: 'List boards',
    description:
      'The boards the caller is a member of (directly, through a room or a group), newest first, a page at a time.',
    status: 200,
    type: BoardPage,
    example: { items: [BOARD_EXAMPLE], next: null },
    errors: [400],
  })
  @ApiQuery({
    name: 'roomId',
    required: false,
    description: 'Only the boards of this room.',
    schema: { type: 'string', format: 'uuid' },
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
    description: 'Boards per page, 1 to 200.',
    schema: { type: 'integer', minimum: 1, maximum: 200, default: 50 },
  })
  async list(
    @AccessToken() token: string,
    @Query('cursor') cursor?: unknown,
    @Query('limit') limit?: unknown,
    @Query('roomId') roomId?: unknown,
  ): Promise<Page<PublicBoard>> {
    if (roomId !== undefined && (typeof roomId !== 'string' || !isUuid(roomId))) {
      throw new BadRequestException('roomId is not an id.');
    }
    const boards = (await this.backend.listBoards(token)).map(toPublicBoard);
    const inRoom =
      roomId === undefined ? boards : boards.filter((board) => board.roomId === roomId);
    return paginate(inRoom, boardsOrder, { cursor, limit });
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @PublicRoute({
    scope: 'boards:write',
    summary: 'Create a board',
    description: 'A new, empty board owned by the caller.',
    status: 201,
    type: PublicBoard,
    example: BOARD_EXAMPLE,
    headers: {
      Location: { description: 'The address of the new board.', schema: { type: 'string' } },
      ETag: {
        description: 'The version of the board, for `If-Match`.',
        schema: { type: 'string' },
      },
    },
    errors: [400, 413],
  })
  @ApiBody({ type: BoardName, examples: { board: { value: { name: 'Sprint 42 retro' } } } })
  async create(
    @AccessToken() token: string,
    @Body() body: unknown,
    @Res({ passthrough: true }) response: Response,
  ): Promise<PublicBoard> {
    return this.created(response, await this.backend.createBoard(token, nameFrom(body)));
  }

  @Get(':id')
  @PublicRoute({
    scope: 'boards:read',
    summary: 'Read a board',
    status: 200,
    type: PublicBoard,
    example: BOARD_EXAMPLE,
    headers: {
      ETag: {
        description: 'The version of the board, for `If-Match`.',
        schema: { type: 'string' },
      },
    },
    errors: [404],
  })
  @ApiParam({ name: 'id', format: 'uuid', example: EXAMPLE_IDS.BOARD_ID })
  async get(
    @AccessToken() token: string,
    @Param('id', uuid) id: string,
    @Res({ passthrough: true }) response: Response,
  ): Promise<PublicBoard> {
    const board = await this.backend.getBoard(token, id);
    response.setHeader('ETag', boardEtag(board));
    return toPublicBoard(board);
  }

  @Patch(':id')
  @PublicRoute({
    scope: 'boards:write',
    summary: 'Rename a board',
    description:
      'Editors and owners. Send `If-Match` with the `ETag` of the board as read (or `*` to rename whatever it is called now): ' +
      'a board that was renamed or moved meanwhile is `412`, so a script never overwrites a change it has not seen.',
    status: 200,
    type: PublicBoard,
    example: { ...BOARD_EXAMPLE, name: 'Sprint 42 retro (done)' },
    headers: { ETag: { description: 'The new version of the board.', schema: { type: 'string' } } },
    errors: [400, 404, 412, 413, 428],
  })
  @ApiParam({ name: 'id', format: 'uuid', example: EXAMPLE_IDS.BOARD_ID })
  @ApiHeader({
    name: 'If-Match',
    required: true,
    description: 'The `ETag` of the board, or `*`.',
    example: '"q0dC4Tz0xkS2iY8bS1m2nVq7p3J"',
  })
  @ApiBody({ type: BoardName, examples: { rename: { value: { name: 'Sprint 42 retro (done)' } } } })
  async rename(
    @AccessToken() token: string,
    @Param('id', uuid) id: string,
    @Headers('if-match') ifMatch: string | undefined,
    @Body() body: unknown,
    @Res({ passthrough: true }) response: Response,
  ): Promise<PublicBoard> {
    const name = nameFrom(body);
    if (ifMatch === undefined || ifMatch.trim() === '') {
      throw new HttpException(
        'Send If-Match with the ETag of the board (GET it first), or * to rename it as it is now.',
        HttpStatus.PRECONDITION_REQUIRED,
      );
    }
    const current = await this.backend.getBoard(token, id);
    if (!ifMatchAccepts(ifMatch, boardEtag(current))) {
      throw new HttpException(
        'The board changed since it was read: read it again.',
        HttpStatus.PRECONDITION_FAILED,
      );
    }
    const renamed = await this.backend.renameBoard(token, id, name);
    response.setHeader('ETag', boardEtag(renamed));
    return toPublicBoard(renamed);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @PublicRoute({
    scope: 'boards:write',
    summary: 'Delete a board',
    description:
      'Owners only. The board, its content, its files and its versions are gone for everybody.',
    status: 204,
    errors: [404],
  })
  @ApiParam({ name: 'id', format: 'uuid', example: EXAMPLE_IDS.BOARD_ID })
  async remove(@AccessToken() token: string, @Param('id', uuid) id: string): Promise<void> {
    await this.backend.deleteBoard(token, id);
  }

  @Post(':id/duplicate')
  @HttpCode(HttpStatus.CREATED)
  @PublicRoute({
    scope: 'boards:write',
    summary: 'Duplicate a board',
    description:
      'A copy of a board the caller may read, owned by the caller, with its content and images (not its members or versions).',
    status: 201,
    type: PublicBoard,
    example: {
      ...BOARD_EXAMPLE,
      id: '0192f7a6-2b3c-7d4e-8f50-617283940a5b',
      name: 'Sprint 42 retro (copy)',
    },
    headers: {
      Location: { description: 'The address of the new board.', schema: { type: 'string' } },
      ETag: { description: 'The version of the new board.', schema: { type: 'string' } },
    },
    errors: [404],
  })
  @ApiParam({ name: 'id', format: 'uuid', example: EXAMPLE_IDS.BOARD_ID })
  async duplicate(
    @AccessToken() token: string,
    @Param('id', uuid) id: string,
    @Res({ passthrough: true }) response: Response,
  ): Promise<PublicBoard> {
    return this.created(response, await this.backend.duplicateBoard(token, id));
  }

  @Get(':id/elements')
  @PublicRoute({
    scope: 'boards:read',
    summary: 'Read the elements of a board',
    description:
      'The board as an Excalidraw scene (`.excalidraw`, version 2): the live elements in drawing order, and the images as links to ' +
      'their files (`files.<id>.url`), never inline. It is the state of the last save, at most about 10 seconds behind an open ' +
      'board. Read-only: v1 cannot change elements.',
    status: 200,
    type: Scene,
    example: {
      type: 'excalidraw',
      version: 2,
      source: 'elysion',
      elements: [
        {
          id: 'k3Jd9',
          type: 'rectangle',
          x: 120,
          y: 80,
          width: 200,
          height: 120,
          index: 'a0',
          version: 3,
          isDeleted: false,
        },
        {
          id: 'p8Lq2',
          type: 'image',
          x: 400,
          y: 80,
          width: 320,
          height: 180,
          index: 'a1',
          fileId: 'f3a9c1d27b',
          isDeleted: false,
        },
      ],
      appState: {},
      files: {
        f3a9c1d27b: {
          id: 'f3a9c1d27b',
          mimeType: 'image/png',
          created: 1761902100000,
          url: `/public/v1/boards/${EXAMPLE_IDS.BOARD_ID}/files/f3a9c1d27b`,
        },
      },
    },
    errors: [404],
  })
  @ApiParam({ name: 'id', format: 'uuid', example: EXAMPLE_IDS.BOARD_ID })
  async elements(@AccessToken() token: string, @Param('id', uuid) id: string): Promise<SceneShape> {
    const state = await this.backend.getBoardDocument(token, id);
    return state === null ? emptyScene() : sceneOf(state, (fileId) => fileUrl(id, fileId));
  }

  @Get(':id/files/:fileId')
  @PublicRoute({
    scope: 'boards:read',
    summary: 'Read a file of a board',
    description:
      'The bytes of an image of the board, as linked from its elements (`files.<id>.url`).',
    status: 200,
    binary: 'image/*',
    errors: [404],
  })
  @ApiParam({ name: 'id', format: 'uuid', example: EXAMPLE_IDS.BOARD_ID })
  @ApiParam({ name: 'fileId', example: 'f3a9c1d27b' })
  async file(
    @AccessToken() token: string,
    @Param('id', uuid) id: string,
    @Param('fileId') fileId: string,
    @Res() response: Response,
  ): Promise<void> {
    if (!FILE_ID.test(fileId)) {
      throw new NotFoundException();
    }
    const file = await this.backend.getFile(token, id, fileId);
    response.status(HttpStatus.OK).set(file.headers);
    await pipeline(file.stream, response);
  }

  private created(response: Response, board: Board): PublicBoard {
    response.setHeader('Location', `${PUBLIC_PREFIX}/boards/${board.id}`);
    response.setHeader('ETag', boardEtag(board));
    return toPublicBoard(board);
  }
}

export function fileUrl(boardId: string, fileId: string): string {
  return `${PUBLIC_PREFIX}/boards/${boardId}/files/${encodeURIComponent(fileId)}`;
}
