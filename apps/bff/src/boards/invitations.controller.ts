import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { AccessToken } from '../auth/access-token.decorator.js';
import {
  type AcceptedInvitation,
  BusinessBackendClient,
  type CreateInvitationInput,
  type CreatedInvitation,
  type Invitation,
} from './business-backend.client.js';

// An id that is not a UUID cannot exist, so it is a 404 without asking the backend.
const uuid = new ParseUUIDPipe({ errorHttpStatusCode: HttpStatus.NOT_FOUND });

/** A token is 32 random bytes as base64url: 43 characters. Anything else cannot be one, so it is a 404 without a call. */
const TOKEN = /^[A-Za-z0-9_-]{43}$/;

function inputFrom(body: unknown): CreateInvitationInput {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new BadRequestException('Send the link as a JSON object.');
  }
  const { role, expiresInHours, maxUses } = body as Record<string, unknown>;
  return {
    ...(typeof role === 'string' ? { role } : {}),
    ...(typeof expiresInHours === 'number' ? { expiresInHours } : {}),
    ...(typeof maxUses === 'number' ? { maxUses } : {}),
  };
}

/**
 * Invitation links (#734): the BFF forwards under the same paths with the caller's token. Who may make, list and revoke them (owners),
 * the limits and what following one does are the business backend's. The token appears in the answer to making a link and in the
 * path of accepting one, nowhere else; the request log has the route pattern, never the URL.
 */
@Controller('api')
export class InvitationsController {
  constructor(private readonly backend: BusinessBackendClient) {}

  @Get('boards/:id/invitations')
  listForBoard(@AccessToken() token: string, @Param('id', uuid) id: string): Promise<Invitation[]> {
    return this.backend.listInvitations(token, 'boards', id);
  }

  @Post('boards/:id/invitations')
  createForBoard(
    @AccessToken() token: string,
    @Param('id', uuid) id: string,
    @Body() body: unknown,
  ): Promise<CreatedInvitation> {
    return this.backend.createInvitation(token, 'boards', id, inputFrom(body));
  }

  @Delete('boards/:id/invitations/:invitationId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async revokeForBoard(
    @AccessToken() token: string,
    @Param('id', uuid) id: string,
    @Param('invitationId', uuid) invitationId: string,
  ): Promise<void> {
    await this.backend.revokeInvitation(token, 'boards', id, invitationId);
  }

  @Get('rooms/:id/invitations')
  listForRoom(@AccessToken() token: string, @Param('id', uuid) id: string): Promise<Invitation[]> {
    return this.backend.listInvitations(token, 'rooms', id);
  }

  @Post('rooms/:id/invitations')
  createForRoom(
    @AccessToken() token: string,
    @Param('id', uuid) id: string,
    @Body() body: unknown,
  ): Promise<CreatedInvitation> {
    return this.backend.createInvitation(token, 'rooms', id, inputFrom(body));
  }

  @Delete('rooms/:id/invitations/:invitationId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async revokeForRoom(
    @AccessToken() token: string,
    @Param('id', uuid) id: string,
    @Param('invitationId', uuid) invitationId: string,
  ): Promise<void> {
    await this.backend.revokeInvitation(token, 'rooms', id, invitationId);
  }

  @Post('invitations/:token/accept')
  @HttpCode(HttpStatus.OK)
  accept(
    @AccessToken() token: string,
    @Param('token') invitationToken: string,
  ): Promise<AcceptedInvitation> {
    if (!TOKEN.test(invitationToken)) {
      throw new NotFoundException('This invitation link does not exist.');
    }
    return this.backend.acceptInvitation(token, invitationToken);
  }
}
