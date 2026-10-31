import {
  BadRequestException,
  Body,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  UnauthorizedException,
} from '@nestjs/common';
import { InternalCallVerifier, InvalidInternalCallError } from '../auth/internal-call-verifier.js';
import { YjsRoomRegistry } from '../yjs/yjs-room-registry.js';
import { SnapshotSource } from './snapshot-source.js';

const MAX_NAME = 200;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** What the backend says about a restore: which version, who restored it, when the version was made. */
export interface RestoreRequest {
  snapshotId: string;
  by: string;
  at: string;
}

/** The body of the backend's call, checked field by field; `null` when it is not valid. */
export function parseRestoreRequest(body: unknown): RestoreRequest | null {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return null;
  const { snapshotId, by, at } = body as Record<string, unknown>;
  if (typeof snapshotId !== 'string' || !UUID.test(snapshotId)) return null;
  if (typeof by !== 'string' || by.length === 0 || by.length > MAX_NAME) return null;
  if (typeof at !== 'string' || at.length > 64 || Number.isNaN(Date.parse(at))) return null;
  return { snapshotId, by, at };
}

/**
 * The business backend restores a version onto a board (ADR 0032, #847): this reads the version's bytes from the backend,
 * merges them forward into the live document, stores it and tells the clients who did it. Answers 204 when the board is
 * restored and stored, 404 when the version is not there. Not routed at the edge; the service token is the only way in.
 */
@Controller('internal/boards')
export class InternalRestoreController {
  constructor(
    private readonly verifier: InternalCallVerifier,
    private readonly registry: YjsRoomRegistry,
    private readonly snapshots: SnapshotSource,
  ) {}

  @Post(':boardId/restore')
  @HttpCode(HttpStatus.NO_CONTENT)
  async restore(
    @Headers('authorization') authorization: string | undefined,
    @Param('boardId', new ParseUUIDPipe()) boardId: string,
    @Body() body: unknown,
  ): Promise<void> {
    try {
      await this.verifier.verify(authorization);
    } catch (error) {
      if (error instanceof InvalidInternalCallError) throw new UnauthorizedException();
      throw error;
    }
    const request = parseRestoreRequest(body);
    if (!request) throw new BadRequestException('The restore request is not valid.');

    const state = await this.snapshots.read(boardId, request.snapshotId);
    if (!state) throw new NotFoundException('The version is not there.');
    await this.registry.restoreSnapshot(boardId, state, JSON.stringify(request));
  }
}
