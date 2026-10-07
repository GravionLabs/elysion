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
import { BusinessBackendClient, type Room } from './business-backend.client.js';
import { textField, uuidPipe } from './request-parsing.js';

/**
 * Rooms (ADR 0019): shared spaces that group boards. Passed on to the business backend with the caller's own
 * token; it decides what the caller may do (a room they have no role in is a 404, a role that is too low a 403)
 * and checks the name (400). Moving a board into a room is `PUT /api/boards/:id/room` in the boards controller.
 */
@Controller('api/rooms')
export class RoomsController {
  constructor(private readonly backend: BusinessBackendClient) {}

  @Get()
  list(@AccessToken() token: string): Promise<Room[]> {
    return this.backend.listRooms(token);
  }

  @Post()
  create(@AccessToken() token: string, @Body() body: unknown): Promise<Room> {
    return this.backend.createRoom(token, textField(body, 'name', 'A room'));
  }

  @Patch(':id')
  rename(
    @AccessToken() token: string,
    @Param('id', uuidPipe) id: string,
    @Body() body: unknown,
  ): Promise<Room> {
    return this.backend.renameRoom(token, id, textField(body, 'name', 'A room'));
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@AccessToken() token: string, @Param('id', uuidPipe) id: string): Promise<void> {
    await this.backend.deleteRoom(token, id);
  }
}
