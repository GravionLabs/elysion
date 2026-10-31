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
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { pipeline } from 'node:stream/promises';
import { AccessToken } from '../auth/access-token.decorator.js';
import { type BoardResponse, toResponse } from './boards.controller.js';
import {
  type BoardSnapshot,
  BusinessBackendClient,
  type RestoreSnapshotResult,
} from './business-backend.client.js';

// An id that is not a UUID cannot exist, so it is a 404 without asking the backend.
const uuid = new ParseUUIDPipe({ errorHttpStatusCode: HttpStatus.NOT_FOUND });

/** The name of a body: absent is fine for a save (`required` false), anything but a string is a 400. */
function nameFrom(body: unknown, required: boolean): string | undefined {
  if (body === undefined || body === null) {
    if (required) throw new BadRequestException('Send the name as a JSON object.');
    return undefined;
  }
  if (typeof body !== 'object' || Array.isArray(body)) {
    throw new BadRequestException('Send the name as a JSON object.');
  }
  const { name } = body as Record<string, unknown>;
  if (name === undefined || name === null) {
    if (required) throw new BadRequestException('A version needs a name.');
    return undefined;
  }
  if (typeof name !== 'string') {
    throw new BadRequestException('The name must be a text.');
  }
  return name;
}

/**
 * The versions of a board (ADR 0032, #846): the BFF forwards under the same paths with the caller's token. The business
 * backend decides by the board's role (viewers list and read, editors save and rename, owners delete) and takes the bytes
 * from the stored board document; the BFF never accepts bytes from the browser.
 */
@Controller('api/boards/:id/snapshots')
export class SnapshotsController {
  constructor(private readonly backend: BusinessBackendClient) {}

  @Get()
  list(@AccessToken() token: string, @Param('id', uuid) id: string): Promise<BoardSnapshot[]> {
    return this.backend.listSnapshots(token, id);
  }

  @Post()
  create(
    @AccessToken() token: string,
    @Param('id', uuid) id: string,
    @Body() body: unknown,
  ): Promise<BoardSnapshot> {
    return this.backend.createSnapshot(token, id, nameFrom(body, false));
  }

  /** The Yjs state of a version, for the preview picture and for opening it as a new board. */
  @Get(':snapshotId/document')
  async document(
    @AccessToken() token: string,
    @Param('id', uuid) id: string,
    @Param('snapshotId', uuid) snapshotId: string,
    @Res() response: Response,
  ): Promise<void> {
    const file = await this.backend.getSnapshotDocument(token, id, snapshotId);
    response.status(HttpStatus.OK).set({ ...file.headers, 'cache-control': 'private, no-store' });
    await pipeline(file.stream, response);
  }

  @Patch(':snapshotId')
  rename(
    @AccessToken() token: string,
    @Param('id', uuid) id: string,
    @Param('snapshotId', uuid) snapshotId: string,
    @Body() body: unknown,
  ): Promise<BoardSnapshot> {
    return this.backend.renameSnapshot(token, id, snapshotId, nameFrom(body, true) ?? '');
  }

  /** Restores a version onto the board: owners only (the backend decides). Every client of the board follows by itself. */
  @Post(':snapshotId/restore')
  @HttpCode(HttpStatus.OK)
  restore(
    @AccessToken() token: string,
    @Param('id', uuid) id: string,
    @Param('snapshotId', uuid) snapshotId: string,
  ): Promise<RestoreSnapshotResult> {
    return this.backend.restoreSnapshot(token, id, snapshotId);
  }

  /** "Open as new board": like duplicate, with the state of the version; anybody who may read the board and create boards. */
  @Post(':snapshotId/copy')
  async openAsNewBoard(
    @AccessToken() token: string,
    @Param('id', uuid) id: string,
    @Param('snapshotId', uuid) snapshotId: string,
  ): Promise<BoardResponse> {
    return toResponse(await this.backend.openSnapshotAsNewBoard(token, id, snapshotId));
  }

  @Delete(':snapshotId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @AccessToken() token: string,
    @Param('id', uuid) id: string,
    @Param('snapshotId', uuid) snapshotId: string,
  ): Promise<void> {
    await this.backend.deleteSnapshot(token, id, snapshotId);
  }
}
