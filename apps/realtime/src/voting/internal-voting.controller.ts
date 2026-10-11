import {
  BadRequestException,
  Body,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  UnauthorizedException,
} from '@nestjs/common';
import { InternalCallVerifier, InvalidInternalCallError } from '../auth/internal-call-verifier.js';
import { YjsRoomRegistry } from '../yjs/yjs-room-registry.js';
import { parseVotingNotification } from './voting-broadcast.js';

/**
 * The business backend tells the realtime service that a board's voting changed (ADR 0029), and this relays it to every
 * client of the board on every instance. Not routed at the edge (only `/yjs` is); the service token is the only way in.
 */
@Controller('internal/boards')
export class InternalVotingController {
  constructor(
    private readonly verifier: InternalCallVerifier,
    private readonly registry: YjsRoomRegistry,
  ) {}

  @Post(':boardId/voting')
  @HttpCode(HttpStatus.NO_CONTENT)
  async announce(
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
    const notification = parseVotingNotification(body);
    if (!notification) {
      throw new BadRequestException('The voting notification is not valid.');
    }
    await this.registry.announceVoting(boardId, JSON.stringify(notification));
  }
}
