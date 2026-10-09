import {
  BadRequestException,
  Controller,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Put,
  Req,
  Res,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { PassThrough } from 'node:stream';
import { finished, pipeline } from 'node:stream/promises';
import { AccessToken } from '../auth/access-token.decorator.js';
import { BusinessBackendClient } from './business-backend.client.js';

const boardId = new ParseUUIDPipe({ errorHttpStatusCode: HttpStatus.NOT_FOUND });

/**
 * The most a file request may announce before the BFF refuses it itself. The business backend has the real limit
 * (`MAX_FILE_BYTES`, 10 MiB by default) and answers 413 for a larger body; this only stops a body that no sensible
 * setting would accept from being piped at all.
 */
export const MAX_FILE_REQUEST_BYTES = 64 * 1024 * 1024;

/**
 * The files (images) of a board, passed through to the business backend as streams: neither direction holds the
 * file in memory. The id is the one Excalidraw gives a file (a content hash); the type and size checks and the
 * authorization belong to the backend.
 */
@Controller('api/boards/:id/files/:fileId')
export class FilesController {
  constructor(private readonly backend: BusinessBackendClient) {}

  @Put()
  @HttpCode(HttpStatus.NO_CONTENT)
  async put(
    @AccessToken() token: string,
    @Param('id', boardId) id: string,
    @Param('fileId') fileId: string,
    @Req() request: Request,
  ): Promise<void> {
    const contentType = request.headers['content-type'];
    const length = Number(request.headers['content-length']);
    if (contentType === undefined) {
      throw new BadRequestException('Send the type of the file as Content-Type.');
    }
    // A stream with no declared length cannot be forwarded as one and could be any size.
    if (!Number.isInteger(length) || length < 0) {
      throw new HttpException(
        'Send the size of the file as Content-Length.',
        HttpStatus.LENGTH_REQUIRED,
      );
    }
    if (length > MAX_FILE_REQUEST_BYTES) {
      throw new HttpException('The file is too large.', HttpStatus.PAYLOAD_TOO_LARGE);
    }
    // The backend's fetch consumes (and, when it answers early, cancels) this stream. Cancelling the request itself
    // would destroy the client's connection in the middle of its upload, and the edge would later reuse that dead
    // connection for another request (a hang, then a 502). So the fetch gets a copy, and what the backend did not
    // read is read and dropped before the error is answered.
    const body = new PassThrough();
    request.pipe(body);
    try {
      await this.backend.putFile(token, id, fileId, { contentType, length, body });
    } catch (error) {
      request.unpipe(body);
      request.resume();
      await finished(request).catch(() => undefined);
      throw error;
    }
  }

  @Get()
  async get(
    @AccessToken() token: string,
    @Param('id', boardId) id: string,
    @Param('fileId') fileId: string,
    @Res() response: Response,
  ): Promise<void> {
    const file = await this.backend.getFile(token, id, fileId);
    response.status(HttpStatus.OK).set(file.headers);
    await pipeline(file.stream, response);
  }
}
