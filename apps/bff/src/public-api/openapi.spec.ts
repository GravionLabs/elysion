import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { API_SCOPES } from '../auth/public-api.js';
import {
  OPENAPI_DOCUMENT_PATH,
  buildOpenApiDocument,
  serializeOpenApiDocument,
  toOpenApi31,
} from './openapi.js';

const committedPath = resolve(import.meta.dirname, '../../../..', OPENAPI_DOCUMENT_PATH);

type Operation = {
  parameters?: Array<{
    in: string;
    name: string;
    example?: unknown;
    schema?: { example?: unknown };
  }>;
  requestBody?: { content: Record<string, { examples?: object; example?: unknown }> };
  responses: Record<string, { content?: Record<string, { example?: unknown; schema?: unknown }> }>;
  'x-required-scope'?: string;
};

describe('the OpenAPI document of the public API (ADR 0033)', () => {
  let generated: string;
  let operations: Array<{ method: string; path: string; operation: Operation }>;

  beforeAll(async () => {
    const document = await buildOpenApiDocument();
    generated = serializeOpenApiDocument(document);
    // `pnpm --filter @elysion/bff openapi` writes the document; CI only compares.
    if (process.env.UPDATE_OPENAPI === '1') {
      writeFileSync(committedPath, generated);
    }
    operations = Object.entries(document.paths).flatMap(([path, item]) =>
      Object.entries(item as Record<string, Operation>).map(([method, operation]) => ({
        method,
        path,
        operation,
      })),
    );
  });

  it('is the committed one: a change of the contract shows in the diff (run `pnpm --filter @elysion/bff openapi`)', () => {
    expect(generated).toBe(readFileSync(committedPath, 'utf8'));
  });

  it('is OpenAPI 3.1 and describes only routes under /public/v1', () => {
    const document = JSON.parse(generated);
    expect(document.openapi).toBe('3.1.0');
    expect(operations.length).toBeGreaterThan(20);
    for (const { path } of operations) {
      expect(path).toMatch(/^\/public\/v1\//);
    }
    expect(generated).not.toContain('"nullable"');
  });

  it('names a known scope on every route but /me', () => {
    for (const { path, operation } of operations) {
      if (path === '/public/v1/me') {
        expect(operation['x-required-scope']).toBeUndefined();
      } else {
        expect(API_SCOPES).toContain(operation['x-required-scope']);
      }
    }
  });

  it('has an example for every route: its parameters, its body and its JSON answers', () => {
    for (const { method, path, operation } of operations) {
      const where = `${method.toUpperCase()} ${path}`;
      for (const parameter of operation.parameters ?? []) {
        if (parameter.in === 'path') {
          expect(
            parameter.example ?? parameter.schema?.example,
            `${where} ${parameter.name}`,
          ).toBeDefined();
        }
      }
      for (const media of Object.values(operation.requestBody?.content ?? {})) {
        expect(media.examples ?? media.example, `${where} body`).toBeDefined();
      }
      for (const [status, response] of Object.entries(operation.responses)) {
        for (const [type, media] of Object.entries(response.content ?? {})) {
          if (type.includes('json')) expect(media.example, `${where} ${status}`).toBeDefined();
        }
      }
    }
  });

  it('answers errors as problem details and announces the rate limit on success', () => {
    for (const { method, path, operation } of operations) {
      const where = `${method.toUpperCase()} ${path}`;
      for (const status of ['401', '403', '429']) {
        expect(
          Object.keys(operation.responses[status]?.content ?? {}),
          `${where} ${status}`,
        ).toEqual(['application/problem+json']);
      }
      const success = Object.entries(operation.responses).find(([status]) =>
        status.startsWith('2'),
      );
      expect(success, where).toBeDefined();
      const headers = (success![1] as { headers?: object }).headers ?? {};
      expect(Object.keys(headers), where).toContain('RateLimit-Remaining');
    }
  });
});

describe('toOpenApi31', () => {
  it('turns nullable into a type list and leaves examples alone', () => {
    expect(
      toOpenApi31({
        properties: {
          roomId: { type: 'string', nullable: true, example: { nullable: true } },
          name: { type: 'string' },
        },
      }),
    ).toEqual({
      properties: {
        roomId: { type: ['string', 'null'], example: { nullable: true } },
        name: { type: 'string' },
      },
    });
  });
});
