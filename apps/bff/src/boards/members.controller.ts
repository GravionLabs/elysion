import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { AccessToken } from '../auth/access-token.decorator.js';
import { type BoardMember, BusinessBackendClient } from './business-backend.client.js';
import { memberTarget, textField, uuidPipe as uuid } from './request-parsing.js';

const text = (body: unknown, field: string) => textField(body, field, 'A member');

/**
 * Who may open a board and as what. Passed on to the business backend with the caller's own token, which allows
 * it for owners only (a 404 for somebody with no role on the board, a 403 for a lower role); the rules of the
 * member list (an unknown email, the last owner) are the backend's and come back as 400, 404 and 409 with its message.
 */
@Controller('api/boards/:id/members')
export class MembersController {
  constructor(private readonly backend: BusinessBackendClient) {}

  @Get()
  list(@AccessToken() token: string, @Param('id', uuid) id: string): Promise<BoardMember[]> {
    return this.backend.listMembers(token, id);
  }

  @Post()
  add(
    @AccessToken() token: string,
    @Param('id', uuid) id: string,
    @Body() body: unknown,
  ): Promise<BoardMember> {
    return this.backend.addMember(token, id, memberTarget(body), text(body, 'role'));
  }

  @Patch(':userId')
  changeRole(
    @AccessToken() token: string,
    @Param('id', uuid) id: string,
    @Param('userId', uuid) userId: string,
    @Body() body: unknown,
  ): Promise<BoardMember> {
    return this.backend.changeMemberRole(token, id, userId, text(body, 'role'));
  }

  @Delete(':userId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @AccessToken() token: string,
    @Param('id', uuid) id: string,
    @Param('userId', uuid) userId: string,
  ): Promise<void> {
    await this.backend.removeMember(token, id, userId);
  }
}
