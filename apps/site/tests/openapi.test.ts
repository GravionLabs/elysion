import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { inlineCode, referenceOf, slug } from '../.vitepress/theme/openapi.mts';

describe('referenceOf', () => {
  it('groups the operations by tag with their scope, parameters, body and examples', () => {
    const groups = referenceOf({
      paths: {
        '/public/v1/boards/{id}': {
          patch: {
            tags: ['Boards'],
            summary: 'Rename a board',
            description: 'Send `If-Match`.',
            'x-required-scope': 'boards:write',
            parameters: [
              {
                name: 'id',
                in: 'path',
                required: true,
                schema: { type: 'string', format: 'uuid', example: 'b1' },
              },
            ],
            requestBody: {
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/BoardName' },
                  examples: { rename: { value: { name: 'New' } } },
                },
              },
            },
            responses: {
              '200': {
                description: 'OK',
                content: {
                  'application/json': {
                    schema: { $ref: '#/components/schemas/PublicBoard' },
                    example: { id: 'b1' },
                  },
                },
              },
              '412': { description: 'Changed.' },
            },
          },
        },
      },
    });

    expect(groups).toEqual([
      {
        tag: 'Boards',
        id: 'boards',
        operations: [
          {
            id: 'patch-public-v1-boards-id',
            method: 'PATCH',
            path: '/public/v1/boards/{id}',
            summary: 'Rename a board',
            description: 'Send `If-Match`.',
            scope: 'boards:write',
            parameters: [
              {
                name: 'id',
                in: 'path',
                required: true,
                type: 'string (uuid)',
                description: '',
                example: '"b1"',
              },
            ],
            requestBody: [
              {
                mediaType: 'application/json',
                schema: 'BoardName',
                example: '{\n  "name": "New"\n}',
              },
            ],
            responses: [
              {
                status: '200',
                description: 'OK',
                bodies: [
                  {
                    mediaType: 'application/json',
                    schema: 'PublicBoard',
                    example: '{\n  "id": "b1"\n}',
                  },
                ],
              },
              { status: '412', description: 'Changed.', bodies: [] },
            ],
          },
        ],
      },
    ]);
  });

  it('renders every operation of the committed document', () => {
    const document = JSON.parse(
      readFileSync(resolve(import.meta.dirname, '../../../docs/api/openapi.v1.json'), 'utf8'),
    );
    const operations = referenceOf(document).flatMap((group) => group.operations);

    expect(operations.length).toBeGreaterThan(20);
    expect(operations.every((operation) => operation.summary !== '')).toBe(true);
  });
});

describe('inlineCode', () => {
  it('escapes the text and turns backticks into code', () => {
    expect(inlineCode('Send `If-Match` <b>&</b>')).toBe(
      'Send <code>If-Match</code> &lt;b&gt;&amp;&lt;/b&gt;',
    );
  });
});

describe('slug', () => {
  it('makes an anchor of a heading', () => {
    expect(slug('GET /public/v1/boards/{id}')).toBe('get-public-v1-boards-id');
  });
});
