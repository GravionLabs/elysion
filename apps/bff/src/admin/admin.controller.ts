import {
  All,
  BadRequestException,
  Controller,
  HttpStatus,
  MethodNotAllowedException,
  NotFoundException,
  Req,
  Res,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { AccessToken } from '../auth/access-token.decorator.js';
import { BusinessBackendClient } from '../boards/business-backend.client.js';

/** The methods the area uses; anything else (HEAD, OPTIONS, TRACE) is refused here, not passed on. */
const METHODS = new Set(['GET', 'POST', 'PATCH', 'PUT', 'DELETE']);

/** A path segment of the area: a word or an id. Nothing else, so a path cannot climb out of `/admin` (`..`) or smuggle a query or a host. */
const SEGMENT = /^[A-Za-z0-9_-]{1,64}$/;

/** The most segments a path of the area has (`groups/:id/members/:userId`). */
const MAX_SEGMENTS = 5;

/** The longest query string passed on. */
const MAX_QUERY_LENGTH = 300;

/**
 * The administration area (ADR 0027, #656): `/api/admin/*` is passed on to the business backend's `/admin/*` with the caller's token,
 * method, query and JSON body, and the backend's status comes back as it is. The BFF holds no rule of its own here: the backend checks
 * the administrator role on every call (403 otherwise) and decides everything else. Only the shape of the path is checked, so that this
 * one wildcard cannot reach anything but the area.
 */
@Controller('api/admin')
export class AdminController {
  constructor(private readonly backend: BusinessBackendClient) {}

  @All()
  forwardRoot(
    @AccessToken() token: string,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<unknown> {
    return this.forward(token, request, response, []);
  }

  @All('*path')
  forwardPath(
    @AccessToken() token: string,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<unknown> {
    // Express 5 hands a wildcard over as the array of its segments.
    const path = (request.params as Record<string, unknown>)['path'];
    return this.forward(token, request, response, Array.isArray(path) ? (path as string[]) : []);
  }

  private async forward(
    token: string,
    request: Request,
    response: Response,
    segments: string[],
  ): Promise<unknown> {
    if (!METHODS.has(request.method)) {
      throw new MethodNotAllowedException();
    }
    if (segments.length > MAX_SEGMENTS || !segments.every((segment) => SEGMENT.test(segment))) {
      throw new NotFoundException();
    }
    const query = queryOf(request);
    const path = `/admin${segments.map((segment) => `/${segment}`).join('')}${query}`;
    const hasBody =
      request.method === 'POST' || request.method === 'PATCH' || request.method === 'PUT';
    const body: unknown =
      hasBody && isPresent(request.body) ? (request.body as unknown) : undefined;

    const answer = await this.backend.forwardAdmin(token, request.method, path, body);
    response.status(answer.status === 200 ? HttpStatus.OK : answer.status);
    return answer.body;
  }
}

/** A body that was sent: an empty object from a client that sent nothing is not one. */
function isPresent(body: unknown): boolean {
  return (
    body !== undefined &&
    body !== null &&
    !(typeof body === 'object' && Object.keys(body).length === 0)
  );
}

/** The query string as `?a=b&c=d`, rebuilt from the parsed values (single strings only), or empty. */
function queryOf(request: Request): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(request.query)) {
    if (typeof value === 'string') {
      params.append(key, value);
    } else if (value !== undefined) {
      throw new BadRequestException(`Send ${key} once, as a plain value.`);
    }
  }
  const text = params.toString();
  if (text.length > MAX_QUERY_LENGTH) {
    throw new BadRequestException('The query is too long.');
  }
  return text === '' ? '' : `?${text}`;
}
