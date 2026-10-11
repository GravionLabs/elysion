import {
  BadRequestException,
  Controller,
  Get,
  Headers,
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

/** The most a thumbnail request may announce before the BFF refuses it; the business backend has the real limit (512 KiB). */
export const MAX_THUMBNAIL_REQUEST_BYTES = 2 * 1024 * 1024;

/**
 * The preview picture of a board, the image on its card (#729), passed through to the business backend as a stream, like a
 * file. The type and size checks and the authorization belong to the backend; `If-None-Match` and the `ETag` pass through, so a
 * card that has the current picture gets a 304.
 */
@Controller('api/boards/:id/thumbnail')
export class ThumbnailController {
  constructor(private readonly backend: BusinessBackendClient) {}

  @Put()
  @HttpCode(HttpStatus.NO_CONTENT)
  async put(
    @AccessToken() token: string,
    @Param('id', boardId) id: string,
    @Req() request: Request,
  ): Promise<void> {
    const contentType = request.headers['content-type'];
    const length = Number(request.headers['content-length']);
    if (contentType === undefined) {
      throw new BadRequestException('Send the type of the picture as Content-Type.');
    }
    if (!Number.isInteger(length) || length < 0) {
      throw new HttpException(
        'Send the size of the picture as Content-Length.',
        HttpStatus.LENGTH_REQUIRED,
      );
    }
    if (length > MAX_THUMBNAIL_REQUEST_BYTES) {
      throw new HttpException('The picture is too large.', HttpStatus.PAYLOAD_TOO_LARGE);
    }
    // As for a file: the fetch gets a copy of the stream, and what the backend did not read is read and dropped before an error
    // is answered, so that the client's connection is not destroyed in the middle of its upload.
    const body = new PassThrough();
    request.pipe(body);
    try {
      await this.backend.putThumbnail(token, id, { contentType, length, body });
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
    @Headers('if-none-match') ifNoneMatch: string | undefined,
    @Res() response: Response,
  ): Promise<void> {
    const picture = await this.backend.getThumbnail(token, id, ifNoneMatch);
    if (picture === 'not-modified') {
      response.status(HttpStatus.NOT_MODIFIED).end();
      return;
    }
    response.status(HttpStatus.OK).set(picture.headers);
    await pipeline(picture.stream, response);
  }
}
