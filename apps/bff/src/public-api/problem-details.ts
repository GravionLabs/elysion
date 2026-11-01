import { STATUS_CODES } from 'node:http';
import { type ArgumentsHost, Catch, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { BaseExceptionFilter } from '@nestjs/core';
import type { NextFunction, Request, Response } from 'express';

/** The path of the public API (ADR 0033): its errors are problem details, everybody else's keep Nest's format. */
export const PUBLIC_API_PATH = '/public/';

export const PROBLEM_CONTENT_TYPE = 'application/problem+json';

/** An error of the public API (RFC 9457). `code` is Elysion's own word where a client may act on it (`account-deactivated`). */
export interface Problem {
  type: string;
  title: string;
  status: number;
  detail?: string;
  code?: string;
}

export function isPublicApiRequest(request: { url?: string; originalUrl?: string }): boolean {
  return (request.originalUrl ?? request.url ?? '').startsWith(PUBLIC_API_PATH);
}

/** The problem an exception becomes: its status, the standard title of it, and its message as `detail` when it says more. */
export function problemOf(exception: unknown): Problem {
  if (!(exception instanceof HttpException)) {
    const status = HttpStatus.INTERNAL_SERVER_ERROR;
    return { type: 'about:blank', title: STATUS_CODES[status] ?? 'Error', status };
  }
  const status = exception.getStatus();
  const title = STATUS_CODES[status] ?? 'Error';
  const body = exception.getResponse();
  const message = typeof body === 'string' ? body : (body as { message?: unknown }).message;
  const text = Array.isArray(message) ? message.join(' ') : message;
  const code = typeof body === 'object' ? (body as { code?: unknown }).code : undefined;
  return {
    type: 'about:blank',
    title,
    status,
    ...(typeof text === 'string' && text !== '' && text !== title ? { detail: text } : {}),
    ...(typeof code === 'string' ? { code } : {}),
  };
}

export function sendProblem(response: Response, problem: Problem): void {
  response
    .status(problem.status)
    .setHeader('Content-Type', `${PROBLEM_CONTENT_TYPE}; charset=utf-8`)
    .send(JSON.stringify(problem));
}

/**
 * Errors of the public API as problem details (RFC 9457, ADR 0033): every exception of a request under `/public/`, also the
 * guard's `401` and `403` and a path no route matches, is answered `application/problem+json`. Any other request is handed to
 * Nest's own filter unchanged, so the browser's routes keep their format.
 */
@Catch()
export class ProblemDetailsFilter extends BaseExceptionFilter {
  readonly #logger = new Logger('PublicApi');

  override catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<Request>();
    const response = http.getResponse<Response>();
    if (host.getType() !== 'http' || !isPublicApiRequest(request)) {
      super.catch(exception, host);
      return;
    }
    if (!(exception instanceof HttpException)) {
      this.#logger.error(exception instanceof Error ? exception : String(exception));
    }
    if (response.headersSent) {
      response.end();
      return;
    }
    sendProblem(response, problemOf(exception));
  }
}

/**
 * The errors of the JSON body parser of a public route (malformed JSON `400`, a body over 1 MiB `413`), which happen before Nest
 * routes the request: the same problem details. Express error middleware, so it has four parameters.
 */
export function publicBodyErrors(
  error: { status?: unknown; statusCode?: unknown; type?: unknown },
  request: Request,
  response: Response,
  next: NextFunction,
): void {
  if (!isPublicApiRequest(request) || response.headersSent) {
    next(error);
    return;
  }
  const status =
    typeof error.status === 'number' && error.status >= 400 && error.status < 600
      ? error.status
      : HttpStatus.BAD_REQUEST;
  const detail =
    status === HttpStatus.PAYLOAD_TOO_LARGE
      ? 'The body is larger than 1 MiB.'
      : 'The body is not valid JSON.';
  sendProblem(response, {
    type: 'about:blank',
    title: STATUS_CODES[status] ?? 'Error',
    status,
    detail,
  });
}
