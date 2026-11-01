import { describe, expect, it } from 'vitest';
import { isReadAsJson, isReadAsPublicJson } from './http-limits.js';

const json = { 'content-type': 'application/json' };

describe('isReadAsJson', () => {
  it('reads an application/json body, with or without a charset', () => {
    expect(isReadAsJson({ url: '/api/templates', headers: json })).toBe(true);
    expect(
      isReadAsJson({
        url: '/api/templates',
        headers: { 'content-type': 'application/json; charset=utf-8' },
      }),
    ).toBe(true);
  });

  it('does not read the public CSP report endpoint, whose body is limited to 8 kB by its own reader', () => {
    expect(isReadAsJson({ url: '/api/csp-report', headers: json })).toBe(false);
    expect(isReadAsJson({ url: '/api/csp-report?x=1', headers: json })).toBe(false);
  });

  it('does not read other content types', () => {
    expect(isReadAsJson({ url: '/api/templates', headers: { 'content-type': 'text/plain' } })).toBe(
      false,
    );
    expect(isReadAsJson({ url: '/api/templates', headers: {} })).toBe(false);
  });
});

describe('the public API body', () => {
  it('is read by its own parser (1 MiB), not by the global one', () => {
    expect(isReadAsJson({ url: '/public/v1/boards', headers: json })).toBe(false);
    expect(isReadAsPublicJson({ url: '/public/v1/boards', headers: json })).toBe(true);
    expect(
      isReadAsPublicJson({
        url: '/public/v1/boards/x?y=1',
        headers: { 'content-type': 'application/merge-patch+json' },
      }),
    ).toBe(true);
  });

  it('is read only under /public and only as JSON', () => {
    expect(isReadAsPublicJson({ url: '/api/boards', headers: json })).toBe(false);
    expect(
      isReadAsPublicJson({ url: '/public/v1/boards', headers: { 'content-type': 'text/plain' } }),
    ).toBe(false);
  });
});
