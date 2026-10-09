import { createRequire } from 'node:module';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { multistream, type DestinationStream } from 'pino';
import type { Options } from 'pino-http';
import { createOtlpStream, parseHeaders } from './otlp.js';
import { connectionFields, settleRequestId } from './request-id.js';

export type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';
export type LogFormat = 'json' | 'text';

const LEVELS: readonly LogLevel[] = ['trace', 'debug', 'info', 'warn', 'error', 'fatal'];

/** `LOG_LEVEL`: one of the six words, `info` for anything else or nothing. */
export function parseLogLevel(value: string | undefined): LogLevel {
  const level = value?.trim().toLowerCase();
  return LEVELS.find((candidate) => candidate === level) ?? 'info';
}

/** `LOG_FORMAT`: `json` or `text`; without it text in a terminal and JSON everywhere else (a container). */
export function resolveLogFormat(value: string | undefined, isTerminal: boolean): LogFormat {
  const format = value?.trim().toLowerCase();
  if (format === 'json' || format === 'text') {
    return format;
  }
  return isTerminal ? 'text' : 'json';
}

/**
 * Paths whose values never reach a log line (ADR 0025). The request line logs no headers at all; this is for the day
 * somebody logs a request, a response or an options object.
 */
export const REDACT_PATHS: readonly string[] = [
  'authorization',
  'cookie',
  'token',
  'access_token',
  'password',
  'secret',
  '*.authorization',
  '*.cookie',
  '*.set-cookie',
  '*.token',
  '*.access_token',
  '*.password',
  '*.secret',
  '*.*.authorization',
  '*.*.cookie',
  '*.*.set-cookie',
  '*.*.token',
  '*.*.secret',
];

/** A URL without its query string: `/yjs?board=1&token=abc` is `/yjs`. The WS token travels in that query. */
export function sanitizeUrl(url: string | undefined): string {
  if (url === undefined) {
    return '';
  }
  const query = url.indexOf('?');
  return query === -1 ? url : url.slice(0, query);
}

/**
 * The shape of an exception in a log line: `type`, `message` and `stack`. pino-http serializes the error of a failed
 * request itself first and pino then calls this on the result, so an object that already has that shape is accepted too.
 */
export function serializeError(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    return { type: error.name, message: error.message, stack: error.stack };
  }
  if (
    typeof error === 'object' &&
    error !== null &&
    typeof (error as { message?: unknown }).message === 'string'
  ) {
    const { type, message, stack } = error as { type?: unknown; message: string; stack?: unknown };
    return { type: typeof type === 'string' ? type : 'Error', message, stack };
  }
  return { type: 'NonError', message: String(error) };
}

export interface LoggerParams {
  /** `elysion-bff` or `elysion-realtime`. */
  service: string;
  /** `LOG_LEVEL`. */
  level?: string;
  /** `LOG_FORMAT`. */
  format?: string;
  /** Where JSON goes; stdout when unset. A test reads it here. */
  stream?: DestinationStream;
  /**
   * `OTEL_EXPORTER_OTLP_LOGS_ENDPOINT`: when set, every line is also sent to this OTLP/HTTP logs endpoint, the viewer of
   * the dev stack (ADR 0025). Unset (the default), nothing is sent and the OpenTelemetry packages are not loaded.
   */
  otlpEndpoint?: string;
  /** `OTEL_EXPORTER_OTLP_LOGS_HEADERS`: `name=value,name2=value2` for the OTLP requests. */
  otlpHeaders?: string;
  /** Paths (without query) whose request line is logged at `debug`: health checks and metrics run every few seconds. */
  quietPaths?: readonly string[];
}

interface ExpressLikeRequest extends IncomingMessage {
  baseUrl?: string;
  route?: { path?: string };
}

function settledId(request: IncomingMessage): string {
  const header = request.headers['x-request-id'];
  return typeof header === 'string' ? header : '';
}

/** The route pattern of a finished request (`/api/boards/:id`), never its URL, so ids and queries stay out of the log. */
function routeOf(request: ExpressLikeRequest): string {
  const path = request.route?.path;
  return typeof path === 'string' ? `${request.baseUrl ?? ''}${path}` : 'unmatched';
}

/**
 * The options of `pino-http` (and so of `nestjs-pino`) for one service, giving every Node service the same log line
 * (ADR 0025, docs/specs/bff.md "Logging"): `timestamp`, `level` (`trace` to `fatal`), `service`, `requestId`,
 * `message`, `userId` once a handler has set it, `err` for an exception, and for the one line per finished request
 * `http` with `method`, `route`, `status` and `durationMs`. JSON, or readable text in a terminal.
 * Returned as the `[options, stream]` pair of `nestjs-pino` when a stream is given, as options otherwise.
 */
export function createPinoHttpOptions(
  params: LoggerParams,
): Options | [Options, DestinationStream] {
  const quiet = params.quietPaths ?? [];
  const format = resolveLogFormat(params.format, process.stdout.isTTY === true);
  const options: Options = {
    level: parseLogLevel(params.level),
    base: { service: params.service },
    messageKey: 'message',
    // A line made inside a WebSocket connection carries the connection's request id and user.
    mixin: () => connectionFields(),
    timestamp: () => `,"timestamp":"${new Date().toISOString()}"`,
    formatters: {
      level: (label) => ({ level: label }),
      // The line of a finished request is a log of `res` and `responseTime`; it becomes the `http` object. `res.req`
      // is the request that belongs to the response.
      log: (object) => {
        const { res, responseTime, ...rest } = object as {
          res?: ServerResponse & { req?: ExpressLikeRequest };
          responseTime?: number;
        };
        if (res?.req === undefined) {
          return object;
        }
        return {
          ...rest,
          http: {
            method: res.req.method,
            route: routeOf(res.req),
            status: res.statusCode,
            durationMs: responseTime,
          },
        };
      },
    },
    redact: { paths: [...REDACT_PATHS], censor: '[redacted]' },
    // pino-http binds the request to every line of its request under `req`, with the id inside; the id becomes a
    // field of its own and the bound request, with its headers and URL, is left out.
    customProps: (request) => ({ requestId: settledId(request) }),
    serializers: {
      err: serializeError,
      req: () => undefined,
    },
    genReqId: (request: IncomingMessage, response: ServerResponse) =>
      settleRequestId(request, response),
    customLogLevel: (request, response, error) => {
      if (error !== undefined || response.statusCode >= 500) {
        return 'error';
      }
      return quiet.includes(sanitizeUrl(request.url)) ? 'debug' : 'info';
    },
    customSuccessMessage: (request, response) =>
      `HTTP ${request.method} ${routeOf(request as ExpressLikeRequest)} responded ${response.statusCode}`,
    customErrorMessage: (request, response) =>
      `HTTP ${request.method} ${routeOf(request as ExpressLikeRequest)} failed with ${response.statusCode}`,
  };

  const endpoint = params.otlpEndpoint?.trim();
  if (endpoint) {
    // stdout (or the stream of a test) as before, and the viewer as a second destination. The logger's own level decides
    // what is written, so both entries take every level.
    const primary = params.stream ?? (format === 'text' ? prettyStream() : process.stdout);
    const viewer = createOtlpStream({
      service: params.service,
      endpoint,
      headers: parseHeaders(params.otlpHeaders),
    });
    return [
      options,
      multistream([
        { level: 'trace', stream: primary },
        { level: 'trace', stream: viewer },
      ]),
    ];
  }
  if (params.stream !== undefined) {
    return [options, params.stream];
  }
  if (format === 'text') {
    const target = prettyTarget();
    if (target !== undefined) {
      return { ...options, transport: { target, options: PRETTY_OPTIONS } };
    }
  }
  return options;
}

const PRETTY_OPTIONS = {
  colorize: true,
  translateTime: 'HH:MM:ss.l',
  timestampKey: 'timestamp',
  messageKey: 'message',
  ignore: 'service',
  messageFormat: '{if requestId}[{requestId}] {end}{message}',
};

/** `pino-pretty` as a stream, for the text format next to another destination (a transport cannot be combined with one). */
function prettyStream(): DestinationStream {
  try {
    const pretty = createRequire(import.meta.url)('pino-pretty') as (
      options: object,
    ) => DestinationStream;
    return pretty({ ...PRETTY_OPTIONS, sync: true });
  } catch {
    return process.stdout; // an optional dependency: without it the text format falls back to JSON
  }
}

/** `pino-pretty` as an absolute path: pino resolves a transport target from its own directory, where a package manager with strict `node_modules` does not have it. */
function prettyTarget(): string | undefined {
  try {
    return createRequire(import.meta.url).resolve('pino-pretty');
  } catch {
    return undefined; // an optional dependency: without it the text format falls back to JSON
  }
}
