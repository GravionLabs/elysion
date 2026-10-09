import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';

/** The header that carries the request id between the services ([ADR 0025](../../docs/adr/0025-structured-logging-and-log-viewer.md)). */
export const REQUEST_ID_HEADER = 'X-Request-Id';

const PATTERN = /^[A-Za-z0-9._-]{8,64}$/;

/** A request id a caller may send: 8 to 64 characters of letters, digits, dot, underscore and hyphen. */
export function isValidRequestId(value: unknown): value is string {
  return typeof value === 'string' && PATTERN.test(value);
}

/**
 * The id of a request: the incoming header when it is well formed, a new UUID otherwise. A value that does not
 * match is replaced and never logged, so a client cannot write anything it likes into the logs.
 */
export function resolveRequestId(incoming: string | string[] | undefined): string {
  return typeof incoming === 'string' && isValidRequestId(incoming) ? incoming : randomUUID();
}

interface RequestContext {
  requestId: string;
}

const storage = new AsyncLocalStorage<RequestContext>();

/** The id of the request being handled, or `undefined` outside one (startup, a timer): what an outgoing call forwards. */
export function currentRequestId(): string | undefined {
  return storage.getStore()?.requestId;
}

/** Runs `work` with `requestId` as the current request id (a WebSocket connection, a test). */
export function runWithRequestId<T>(requestId: string, work: () => T): T {
  return storage.run({ requestId }, work);
}

/**
 * Express-style middleware: settles the request's id, puts it in the request's headers (so everything that reads the
 * header afterwards sees the same, valid value), echoes it in the response and makes it the current request id for
 * the rest of the request.
 */
export function requestIdMiddleware(): (
  request: IncomingMessage,
  response: ServerResponse,
  next: () => void,
) => void {
  return (request, response, next) => {
    const requestId = settleRequestId(request, response);
    storage.run({ requestId }, next);
  };
}

/** Settles the id of `request` and echoes it on `response`; idempotent. */
export function settleRequestId(request: IncomingMessage, response: ServerResponse): string {
  const requestId = resolveRequestId(request.headers['x-request-id']);
  request.headers['x-request-id'] = requestId;
  if (!response.headersSent) {
    response.setHeader(REQUEST_ID_HEADER, requestId);
  }
  return requestId;
}
