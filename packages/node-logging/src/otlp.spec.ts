import { describe, expect, it } from 'vitest';
import { parseHeaders, toAttributes } from './otlp.js';

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
