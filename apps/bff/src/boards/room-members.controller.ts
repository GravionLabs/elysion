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
import { textField, uuidPipe as uuid } from './request-parsing.js';

const text = (body: unknown, field: string) => textField(body, field, 'A member');

/**
 * Who is in a room and as what (ADR 0019), the board member API's twin. Passed on to the business backend with the
 * caller's own token, which allows it for the room's owners only (404 without a role in the room, 403 for a lower
 * one); the rules of the member list come back as 400, 404 and 409 with the backend's message.
 */
@Controller('api/rooms/:id/members')
export class RoomMembersController {
  constructor(private readonly backend: BusinessBackendClient) {}

  @Get()
  list(@AccessToken() token: string, @Param('id', uuid) id: string): Promise<BoardMember[]> {
    return this.backend.listRoomMembers(token, id);
  }

  @Post()
  add(
    @AccessToken() token: string,
    @Param('id', uuid) id: string,
    @Body() body: unknown,
  ): Promise<BoardMember> {
    return this.backend.addRoomMember(token, id, text(body, 'email'), text(body, 'role'));
  }

  @Patch(':userId')
  changeRole(
    @AccessToken() token: string,
    @Param('id', uuid) id: string,
    @Param('userId', uuid) userId: string,
    @Body() body: unknown,
  ): Promise<BoardMember> {
    return this.backend.changeRoomMemberRole(token, id, userId, text(body, 'role'));
  }

  @Delete(':userId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @AccessToken() token: string,
    @Param('id', uuid) id: string,
    @Param('userId', uuid) userId: string,
  ): Promise<void> {
    await this.backend.removeRoomMember(token, id, userId);
  }
}
