import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Writable } from 'node:stream';
import pinoHttp from 'pino-http';
import { afterEach, describe, expect, it } from 'vitest';
import {
  REDACT_PATHS,
  createPinoHttpOptions,
  parseLogLevel,
  resolveLogFormat,
  sanitizeUrl,
  serializeError,
} from './options.js';
import {
  REQUEST_ID_HEADER,
  currentRequestId,
  isValidRequestId,
  requestIdMiddleware,
  resolveRequestId,
  runWithRequestId,
} from './request-id.js';

describe('request ids', () => {
  it.each(['abcd1234', 'bff-1234.abcd_EF', 'a'.repeat(64)])('accepts %s', (id) => {
    expect(isValidRequestId(id)).toBe(true);
    expect(resolveRequestId(id)).toBe(id);
  });

  it.each([
    'short',
    'has spaces in it 1234',
    'semi;colon;chars',
    'x'.repeat(65),
    '',
    'tab\there123',
  ])('replaces %j and never keeps it', (id) => {
    expect(isValidRequestId(id)).toBe(false);
    const resolved = resolveRequestId(id);
    expect(resolved).not.toBe(id);
    expect(isValidRequestId(resolved)).toBe(true);
  });

  it('creates an id for no header and for a header sent twice', () => {
    expect(isValidRequestId(resolveRequestId(undefined))).toBe(true);
    expect(isValidRequestId(resolveRequestId(['abcd1234', 'efgh5678']))).toBe(true);
    expect(resolveRequestId(['abcd1234', 'efgh5678'])).not.toBe('abcd1234');
  });

  it('knows the current request only inside one', () => {
    expect(currentRequestId()).toBeUndefined();
    expect(runWithRequestId('req-12345678', () => currentRequestId())).toBe('req-12345678');
    expect(currentRequestId()).toBeUndefined();
  });
});

describe('settings', () => {
  it('reads the level and falls back to info', () => {
    expect(parseLogLevel('DEBUG')).toBe('debug');
    expect(parseLogLevel(' warn ')).toBe('warn');
    expect(parseLogLevel('loud')).toBe('info');
    expect(parseLogLevel(undefined)).toBe('info');
  });

  it('prints text in a terminal and JSON elsewhere unless told', () => {
    expect(resolveLogFormat(undefined, true)).toBe('text');
    expect(resolveLogFormat(undefined, false)).toBe('json');
    expect(resolveLogFormat('JSON', true)).toBe('json');
    expect(resolveLogFormat('text', false)).toBe('text');
    expect(resolveLogFormat('xml', false)).toBe('json');
  });

  it('drops the query string of a URL, where the WS token travels', () => {
    expect(sanitizeUrl('/yjs?board=1&token=abc')).toBe('/yjs');
    expect(sanitizeUrl('/api/boards/1')).toBe('/api/boards/1');
    expect(sanitizeUrl(undefined)).toBe('');
  });

  it('serializes an exception as type, message and stack', () => {
    const error = new TypeError('boom');
    expect(serializeError(error)).toEqual({
      type: 'TypeError',
      message: 'boom',
      stack: error.stack,
    });
    expect(serializeError('text')).toEqual({ type: 'NonError', message: 'text' });
  });

  it('accepts an error that pino-http has already serialized', () => {
    const done = { type: 'Error', message: 'failed with status code 502', stack: 'Error: ...' };
    expect(serializeError(done)).toEqual(done);
    expect(serializeError({ message: 'no type' })).toEqual({
      type: 'Error',
      message: 'no type',
      stack: undefined,
    });
  });

  it('redacts credentials at the top and one or two levels down', () => {
    expect(REDACT_PATHS).toEqual(
      expect.arrayContaining(['authorization', '*.cookie', '*.*.token']),
    );
  });
});

describe('the request line', () => {
  let server: Server | undefined;
  afterEach(() => {
    server?.close();
    server = undefined;
  });

  /** One request through pino-http with the real options; resolves with the parsed log lines. */
  async function serve(
    path: string,
    headers: Record<string, string> = {},
    configure: (lines: Writable) => void = () => {},
  ): Promise<{ lines: Record<string, unknown>[]; response: Response }> {
    const raw: string[] = [];
    const stream = new Writable({
      write(chunk, _encoding, done) {
        raw.push(String(chunk));
        done();
      },
    });
    configure(stream);
    const [options] = createPinoHttpOptions({
      service: 'elysion-test',
      level: 'debug',
      stream,
      quietPaths: ['/health'],
    }) as [Parameters<typeof pinoHttp>[0], Writable];
    const middleware = pinoHttp(options, stream);
    const withId = requestIdMiddleware();
    server = createServer((request, response) => {
      middleware(request, response);
      withId(request, response, () => {
        const log = (request as unknown as { log: { info(o: object, m: string): void } }).log;
        log.info({ userId: 'u-1', authorization: 'Bearer secret-marker' }, 'handled');
        response.statusCode = path.startsWith('/missing') ? 404 : 200;
        response.end('ok');
      });
    });
    await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as AddressInfo;
    const response = await fetch(`http://127.0.0.1:${port}${path}`, { headers });
    await new Promise((resolve) => setTimeout(resolve, 20));
    return {
      lines: raw
        .join('')
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line) as Record<string, unknown>),
      response,
    };
  }

  it('is one JSON object with the shared fields and no URL', async () => {
    const { lines, response } = await serve('/api/boards?token=query-marker', {
      Cookie: 'session=cookie-marker',
      Authorization: 'Bearer header-marker',
    });

    const request = lines.find((line) => 'http' in line)!;
    expect(request).toMatchObject({
      level: 'info',
      service: 'elysion-test',
      http: { method: 'GET', route: 'unmatched', status: 200 },
    });
    expect(typeof (request.http as { durationMs: unknown }).durationMs).toBe('number');
    expect(request.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    expect(request.message).toBe('HTTP GET unmatched responded 200');
    expect(request.requestId).toBe(response.headers.get(REQUEST_ID_HEADER));
    expect(JSON.stringify(lines)).not.toMatch(
      /query-marker|cookie-marker|header-marker|secret-marker/,
    );
    expect(Object.keys(request)).not.toContain('req');
    expect(Object.keys(request)).not.toContain('responseTime');
  });

  it('keeps a well-formed incoming id and replaces a bad one', async () => {
    const kept = await serve('/api/boards', { 'X-Request-Id': 'bff-1234.abcd_EF' });
    expect(kept.response.headers.get(REQUEST_ID_HEADER)).toBe('bff-1234.abcd_EF');
    expect(kept.lines.every((line) => line.requestId === 'bff-1234.abcd_EF')).toBe(true);

    const replaced = await serve('/api/boards', { 'X-Request-Id': 'bad id with spaces' });
    const id = replaced.response.headers.get(REQUEST_ID_HEADER)!;
    expect(isValidRequestId(id)).toBe(true);
    expect(JSON.stringify(replaced.lines)).not.toContain('bad id with spaces');
  });

  it('carries the fields of the handler and redacts a credential in them', async () => {
    const { lines } = await serve('/api/boards');

    const handled = lines.find((line) => line.message === 'handled')!;
    expect(handled).toMatchObject({ userId: 'u-1', service: 'elysion-test' });
    expect(handled.authorization).toBe('[redacted]');
  });

  it('logs a server error as error and a quiet path at debug', async () => {
    const quiet = await serve('/health');
    expect(quiet.lines.find((line) => 'http' in line)).toMatchObject({ level: 'debug' });
  });
});
