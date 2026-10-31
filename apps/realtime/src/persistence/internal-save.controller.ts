import {
  Controller,
  Headers,
  HttpCode,
  ServiceUnavailableException,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  UnauthorizedException,
} from '@nestjs/common';
import { InternalCallVerifier, InvalidInternalCallError } from '../auth/internal-call-verifier.js';
import { YjsRoomRegistry } from '../yjs/yjs-room-registry.js';

/**
 * The business backend asks for a board to be stored now, right before it keeps a version of it (ADR 0032), so the
 * version holds the last seconds too (and before a restore, #847). Answers 204 once the board is stored, also when it
 * is not open here or has nothing unsaved (the stored state is then current), and 503 when the store refused the save, so
 * the caller knows the stored state may lag the live board. Not routed at the edge; the service token is the only way in.
 */
@Controller('internal/boards')
export class InternalSaveController {
  constructor(
    private readonly verifier: InternalCallVerifier,
    private readonly registry: YjsRoomRegistry,
  ) {}

  @Post(':boardId/save')
  @HttpCode(HttpStatus.NO_CONTENT)
  async save(
    @Headers('authorization') authorization: string | undefined,
    @Param('boardId', new ParseUUIDPipe()) boardId: string,
  ): Promise<void> {
    try {
      await this.verifier.verify(authorization);
    } catch (error) {
      if (error instanceof InvalidInternalCallError) throw new UnauthorizedException();
      throw error;
    }
    if (!(await this.registry.saveNow(boardId))) throw new ServiceUnavailableException();
  }
}
