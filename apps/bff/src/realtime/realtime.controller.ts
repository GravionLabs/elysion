import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  HttpCode,
  HttpStatus,
  Post,
  Req,
} from '@nestjs/common';
import type { BoardRole, WsTokenResponse } from '@elysion/shared-types';
import { AccessToken } from '../auth/access-token.decorator.js';
import type { AuthenticatedRequest } from '../auth/auth.types.js';
import { BusinessBackendClient } from '../boards/business-backend.client.js';
import { WsTokenService } from './ws-token.service.js';

const BOARD_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The realtime service's connection credentials. */
@Controller('api/realtime')
export class RealtimeController {
  constructor(
    private readonly backend: BusinessBackendClient,
    private readonly tokens: WsTokenService,
  ) {}

  /**
   * A short-lived token for one board. Being signed in is not enough: the business backend is asked what the
   * caller's role on the board is, and without one the answer is 403 (a board that does not exist and a board
   * the caller may not see look the same, as the backend's 404 rule intends). The token carries that role.
   */
  @Post('token')
  @HttpCode(HttpStatus.OK)
  async token(
    @Req() request: AuthenticatedRequest,
    @AccessToken() accessToken: string,
    @Body() body: unknown,
  ): Promise<WsTokenResponse> {
    const boardId = (body as { boardId?: unknown } | null)?.boardId;
    if (typeof boardId !== 'string' || boardId.trim() === '') {
      throw new BadRequestException('A token needs a boardId.');
    }
    // Only stored boards (UUIDs) have members; any other id has no role for anybody, so ask nobody.
    const role: BoardRole | null = BOARD_ID.test(boardId)
      ? await this.backend.getMyRole(accessToken, boardId)
      : null;
    if (role === null) {
      throw new ForbiddenException('You may not open this board.');
    }
    return this.tokens.issue({ sub: request.auth.claims.sub, boardId, role });
  }
}
