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
  Post,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { AccessToken } from '../auth/access-token.decorator.js';
import {
  BusinessBackendClient,
  type StartVotingInput,
  type Voting,
} from './business-backend.client.js';

// An id that is not a UUID cannot exist, so it is a 404 without asking the backend.
const uuid = new ParseUUIDPipe({ errorHttpStatusCode: HttpStatus.NOT_FOUND });

/** The fields a start may carry; the limits (1 to 100 votes, the name's length) belong to the business backend, which answers 400. */
function startFrom(body: unknown): StartVotingInput {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new BadRequestException('Send the voting as a JSON object.');
  }
  const { name, votesPerPerson, named } = body as Record<string, unknown>;
  return {
    ...(typeof name === 'string' ? { name } : {}),
    ...(typeof votesPerPerson === 'number' ? { votesPerPerson } : {}),
    ...(typeof named === 'boolean' ? { named } : {}),
  };
}

function elementFrom(body: unknown): string {
  const elementId = (body as { elementId?: unknown } | null)?.elementId;
  if (typeof elementId !== 'string') {
    throw new BadRequestException('A vote needs the id of an element.');
  }
  return elementId;
}

/**
 * Dot voting on the server (#732, ADR 0029): the BFF forwards under the same paths with the caller's token. The
 * authorization (viewers vote; editors start, close and clear), the rules of a vote and what each person may see are the
 * business backend's; this passes its answers on, a `204` for "no voting" included.
 */
@Controller('api/boards/:id')
export class VotingController {
  constructor(private readonly backend: BusinessBackendClient) {}

  @Get('voting')
  async current(
    @AccessToken() token: string,
    @Param('id', uuid) id: string,
    @Res({ passthrough: true }) response: Response,
  ): Promise<Voting | undefined> {
    const voting = await this.backend.getVoting(token, id);
    if (voting === null) {
      response.status(HttpStatus.NO_CONTENT);
      return undefined;
    }
    return voting;
  }

  @Post('votings')
  start(
    @AccessToken() token: string,
    @Param('id', uuid) id: string,
    @Body() body: unknown,
  ): Promise<Voting> {
    return this.backend.startVoting(token, id, startFrom(body));
  }

  @Delete('votings')
  @HttpCode(HttpStatus.NO_CONTENT)
  async clear(@AccessToken() token: string, @Param('id', uuid) id: string): Promise<void> {
    await this.backend.clearVotings(token, id);
  }

  @Post('votings/:votingId/votes')
  @HttpCode(HttpStatus.OK)
  vote(
    @AccessToken() token: string,
    @Param('id', uuid) id: string,
    @Param('votingId', uuid) votingId: string,
    @Body() body: unknown,
  ): Promise<Voting> {
    return this.backend.castVote(token, id, votingId, elementFrom(body));
  }

  @Delete('votings/:votingId/votes/:elementId')
  async retract(
    @AccessToken() token: string,
    @Param('id', uuid) id: string,
    @Param('votingId', uuid) votingId: string,
    @Param('elementId') elementId: string,
    @Res({ passthrough: true }) response: Response,
  ): Promise<Voting | undefined> {
    const voting = await this.backend.retractVote(token, id, votingId, elementId);
    if (voting === null) {
      response.status(HttpStatus.NO_CONTENT);
      return undefined;
    }
    return voting;
  }

  @Post('votings/:votingId/close')
  @HttpCode(HttpStatus.OK)
  close(
    @AccessToken() token: string,
    @Param('id', uuid) id: string,
    @Param('votingId', uuid) votingId: string,
  ): Promise<Voting> {
    return this.backend.closeVoting(token, id, votingId);
  }
}
