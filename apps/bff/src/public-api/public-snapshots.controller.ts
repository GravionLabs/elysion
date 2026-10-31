import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import { ApiBody, ApiParam, ApiQuery, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { AccessToken } from '../auth/access-token.decorator.js';
import { PublicApi } from '../auth/public-api.js';
import { type BoardSnapshot, BusinessBackendClient } from '../boards/business-backend.client.js';
import { uuidPipe as uuid } from '../boards/request-parsing.js';
import { EXAMPLE_IDS, Snapshot, SnapshotName, SnapshotPage, SnapshotWithScene } from './dto.js';
import { type Page, paginate, timeKey } from './pagination.js';
import { PUBLIC_PREFIX, fileUrl } from './public-boards.controller.js';
import { PublicRoute } from './public-route.js';
import { sceneOf } from './scene.js';

const SNAPSHOT_EXAMPLE = {
  id: EXAMPLE_IDS.SNAPSHOT_ID,
  kind: 'Manual',
  name: 'Before the workshop',
  author: 'Ada Lovelace',
  createdAt: '2026-10-31T10:00:00Z',
  sizeBytes: 48213,
  elementCount: 37,
};

const toSnapshot = (snapshot: BoardSnapshot): Snapshot => ({
  id: snapshot.id,
  kind: snapshot.kind,
  name: snapshot.name ?? null,
  author: snapshot.author ?? null,
  createdAt: snapshot.createdAt,
  sizeBytes: snapshot.sizeBytes,
  elementCount: snapshot.elementCount ?? null,
});

const snapshotsOrder = {
  key: (snapshot: Snapshot) => [timeKey(snapshot.createdAt), snapshot.id],
  directions: ['desc', 'asc'] as Array<'asc' | 'desc'>,
};

const NOT_IN_V1 =
  'Renaming, deleting and restoring a version, and opening one as a new board, are not part of v1: they are in the browser only.';

/**
 * The versions of a board on the public API (ADR 0032, ADR 0033, #852): list, save one, and read one as JSON. The business backend
 * decides as for the browser (viewers list and read, editors save) and serves a version's Yjs state, which the BFF decodes into the
 * same Excalidraw scene as the board's elements. Rename, delete, restore and "open as new board" are left out of v1.
 */
@PublicApi()
@ApiTags('Snapshots')
@Controller('public/v1/boards/:id/snapshots')
export class PublicSnapshotsController {
  constructor(private readonly backend: BusinessBackendClient) {}

  @Get()
  @PublicRoute({
    scope: 'boards:read',
    summary: 'List the versions of a board',
    description: `Saved and automatic versions, newest first. ${NOT_IN_V1}`,
    status: 200,
    type: SnapshotPage,
    example: { items: [SNAPSHOT_EXAMPLE], next: null },
    errors: [400, 404],
  })
  @ApiParam({ name: 'id', format: 'uuid', example: EXAMPLE_IDS.BOARD_ID })
  @ApiQuery({
    name: 'cursor',
    required: false,
    description: 'The `next` of the page before.',
    schema: { type: 'string' },
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    description: 'Versions per page, 1 to 200.',
    schema: { type: 'integer', minimum: 1, maximum: 200, default: 50 },
  })
  async list(
    @AccessToken() token: string,
    @Param('id', uuid) id: string,
    @Query('cursor') cursor?: unknown,
    @Query('limit') limit?: unknown,
  ): Promise<Page<Snapshot>> {
    return paginate((await this.backend.listSnapshots(token, id)).map(toSnapshot), snapshotsOrder, {
      cursor,
      limit,
    });
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @PublicRoute({
    scope: 'snapshots:write',
    summary: 'Save a version of a board',
    description: `Editors and owners. Keeps the board as it is now, with an optional name. ${NOT_IN_V1}`,
    status: 201,
    type: Snapshot,
    example: SNAPSHOT_EXAMPLE,
    headers: {
      Location: { description: 'The address of the new version.', schema: { type: 'string' } },
    },
    errors: [400, 404, 409, 413, 503],
  })
  @ApiParam({ name: 'id', format: 'uuid', example: EXAMPLE_IDS.BOARD_ID })
  @ApiBody({
    type: SnapshotName,
    required: false,
    examples: { named: { value: { name: 'Before the workshop' } } },
  })
  async create(
    @AccessToken() token: string,
    @Param('id', uuid) id: string,
    @Body() body: unknown,
    @Res({ passthrough: true }) response: Response,
  ): Promise<Snapshot> {
    const name = (body as { name?: unknown } | null | undefined)?.name;
    if (name !== undefined && name !== null && typeof name !== 'string') {
      throw new BadRequestException("A version's name is text.");
    }
    const snapshot = await this.backend.createSnapshot(token, id, name ?? undefined);
    response.setHeader('Location', `${PUBLIC_PREFIX}/boards/${id}/snapshots/${snapshot.id}`);
    return toSnapshot(snapshot);
  }

  @Get(':snapshotId')
  @PublicRoute({
    scope: 'boards:read',
    summary: 'Read a version of a board',
    description:
      'The version with its content as JSON: the same Excalidraw scene as `GET /public/v1/boards/{id}/elements` (images as links ' +
      `to the board's files). ${NOT_IN_V1}`,
    status: 200,
    type: SnapshotWithScene,
    example: {
      ...SNAPSHOT_EXAMPLE,
      scene: {
        type: 'excalidraw',
        version: 2,
        source: 'elysion',
        elements: [
          { id: 'k3Jd9', type: 'rectangle', x: 120, y: 80, width: 200, height: 120, index: 'a0' },
        ],
        appState: {},
        files: {},
      },
    },
    errors: [404, 410, 503],
  })
  @ApiParam({ name: 'id', format: 'uuid', example: EXAMPLE_IDS.BOARD_ID })
  @ApiParam({ name: 'snapshotId', format: 'uuid', example: EXAMPLE_IDS.SNAPSHOT_ID })
  async get(
    @AccessToken() token: string,
    @Param('id', uuid) id: string,
    @Param('snapshotId', uuid) snapshotId: string,
  ): Promise<SnapshotWithScene> {
    const snapshot = (await this.backend.listSnapshots(token, id)).find(
      (candidate) => candidate.id === snapshotId,
    );
    if (snapshot === undefined) {
      throw new NotFoundException();
    }
    const state = await this.backend.readSnapshotDocument(token, id, snapshotId);
    return { ...toSnapshot(snapshot), scene: sceneOf(state, (fileId) => fileUrl(id, fileId)) };
  }
}
