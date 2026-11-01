import { createServer, type IncomingHttpHeaders } from 'node:http';
import type { AddressInfo } from 'node:net';
import { finished } from 'node:stream/promises';
import { describe, expect, it } from 'vitest';
import { createOtlpStream, parseHeaders, toAttributes } from './otlp.js';

describe('parseHeaders', () => {
  it('reads name=value pairs, trims them and ignores what is not one', () => {
    expect(parseHeaders('a=1, b = two ,broken,=nothing,c=x%20y')).toEqual({
      a: '1',
      b: 'two',
      c: 'x y',
    });
    expect(parseHeaders(undefined)).toEqual({});
    expect(parseHeaders('')).toEqual({});
  });

  it('keeps an equals sign inside a value', () => {
    expect(parseHeaders('authorization=Basic abc==')).toEqual({ authorization: 'Basic abc==' });
  });
});

describe('toAttributes', () => {
  it('leaves out what is the record itself, keeps the level word and flattens nested objects to dotted names', () => {
    expect(
      toAttributes({
        timestamp: '2026-10-09T05:00:00.000Z',
        level: 'info',
        message: 'HTTP GET /api/boards responded 200',
        service: 'elysion-bff',
        requestId: 'req-12345678',
        userId: 'u-1',
        http: { method: 'GET', route: '/api/boards', status: 200, durationMs: 3.5 },
        err: { type: 'Error', message: 'boom', stack: 'Error: boom\n at x' },
        nothing: null,
        list: [1, 2],
        flag: true,
      }),
    ).toEqual({
      level: 'info',
      requestId: 'req-12345678',
      userId: 'u-1',
      'http.method': 'GET',
      'http.route': '/api/boards',
      'http.status': 200,
      'http.durationMs': 3.5,
      'err.type': 'Error',
      'err.message': 'boom',
      'err.stack': 'Error: boom\n at x',
      list: '[1,2]',
      flag: true,
    });
  });
});

describe('createOtlpStream', () => {
  it('sends a line as OTLP protobuf to the endpoint, with the service name and the requestId, and no viewer-specific header', async () => {
    const received: { url?: string; headers: IncomingHttpHeaders; body: Buffer }[] = [];
    const server = createServer((request, response) => {
      const chunks: Buffer[] = [];
      request.on('data', (chunk: Buffer) => chunks.push(chunk));
      request.on('end', () => {
        received.push({ url: request.url, headers: request.headers, body: Buffer.concat(chunks) });
        response.writeHead(200, { 'content-type': 'application/x-protobuf' }).end();
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as AddressInfo;
    try {
      const stream = createOtlpStream({
        service: 'elysion-bff',
        endpoint: `http://127.0.0.1:${port}/v1/logs`,
        headers: { 'x-extra': 'yes' },
      });
      stream.end(
        `${JSON.stringify({ level: 'info', message: 'hello', requestId: 'req-abcdef12' })}\n`,
      );
      await finished(stream);

      expect(received).toHaveLength(1);
      const [request] = received;
      expect(request.url).toBe('/v1/logs');
      expect(request.headers['content-type']).toBe('application/x-protobuf');
      expect(request.headers['x-extra']).toBe('yes');
      expect(request.headers['vl-stream-fields']).toBeUndefined();
      const body = request.body.toString('latin1');
      expect(body).toContain('service.name');
      expect(body).toContain('elysion-bff');
      expect(body).toContain('requestId');
      expect(body).toContain('req-abcdef12');
      expect(body).toContain('hello');
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  it('drops the lines without failing when the viewer cannot be reached', async () => {
    // Port 1 on the loopback: nothing listens there, the connection is refused.
    const stream = createOtlpStream({
      service: 'elysion-realtime',
      endpoint: 'http://127.0.0.1:1/v1/logs',
    });
    const errors: unknown[] = [];
    stream.on('error', (error) => errors.push(error));
    const line = `${JSON.stringify({ level: 'warn', message: 'lost', requestId: 'req-00000000' })}\n`;
    await new Promise<void>((resolve, reject) =>
      stream.write(line, (error) => (error ? reject(error) : resolve())),
    );
    await new Promise<void>((resolve) => stream.write('not json\n', () => resolve()));
    // Past the batch delay (1 s): the export has been tried and refused by then.
    await new Promise((resolve) => setTimeout(resolve, 1500));

    expect(stream.writable).toBe(true);
    expect(errors).toEqual([]);
    stream.destroy();
  });
});
