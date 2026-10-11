import { Controller, Delete, Get, HttpCode, HttpStatus, Param, Put, Body } from '@nestjs/common';
import { AccessToken } from '../auth/access-token.decorator.js';
import { BusinessBackendClient, type RoomGroup } from './business-backend.client.js';
import { textField, uuidPipe as uuid } from './request-parsing.js';

/**
 * The groups that have a role in a room (ADR 0027), next to the room's people. Passed on with the caller's own token: everybody
 * who sees the room may list them, only its owners change them (403 for a lower role, 404 without one); an unknown group is a 404.
 */
@Controller('api/rooms/:id/groups')
export class RoomGroupsController {
  constructor(private readonly backend: BusinessBackendClient) {}

  @Get()
  list(@AccessToken() token: string, @Param('id', uuid) id: string): Promise<RoomGroup[]> {
    return this.backend.listRoomGroups(token, id);
  }

  @Put(':groupId')
  set(
    @AccessToken() token: string,
    @Param('id', uuid) id: string,
    @Param('groupId', uuid) groupId: string,
    @Body() body: unknown,
  ): Promise<RoomGroup> {
    return this.backend.setRoomGroupRole(token, id, groupId, textField(body, 'role', 'A group'));
  }

  @Delete(':groupId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @AccessToken() token: string,
    @Param('id', uuid) id: string,
    @Param('groupId', uuid) groupId: string,
  ): Promise<void> {
    await this.backend.removeRoomGroup(token, id, groupId);
  }
}
