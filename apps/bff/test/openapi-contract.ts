import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Ajv2020 } from 'ajv/dist/2020.js';
import { expect } from 'vitest';

/** The committed OpenAPI document of the public API (ADR 0033), the contract the answers are checked against. */
const document = JSON.parse(
  readFileSync(resolve(import.meta.dirname, '../../../docs/api/openapi.v1.json'), 'utf8'),
) as {
  paths: Record<
    string,
    Record<
      string,
      { responses: Record<string, { content?: Record<string, { schema?: unknown }> }> }
    >
  >;
  components: unknown;
};

const ajv = new Ajv2020({ strict: false, validateFormats: false, allErrors: true });
ajv.addSchema({ $id: 'openapi', components: document.components });

/**
 * Checks an answer of the public API against the document: the route and its status are documented, the media type is the
 * documented one, and a JSON body matches the documented schema. `path` is the document's path (`/public/v1/boards/{id}`).
 */
export function expectContract(
  method: string,
  path: string,
  response: { status: number; headers: Record<string, string>; body: unknown },
): void {
  const where = `${method.toUpperCase()} ${path} ${response.status}`;
  const operation = document.paths[path]?.[method.toLowerCase()];
  expect(operation, `${where}: not in the OpenAPI document`).toBeDefined();
  const documented = operation!.responses[String(response.status)];
  expect(documented, `${where}: status not documented`).toBeDefined();
  if (documented!.content === undefined) {
    expect(response.headers['content-type'], `${where}: documented without a body`).toBeUndefined();
    return;
  }
  const mediaType = (response.headers['content-type'] ?? '').split(';')[0]!.trim();
  const [type, media] =
    Object.entries(documented!.content).find(([documentedType]) =>
      documentedType.endsWith('/*')
        ? mediaType.startsWith(documentedType.slice(0, -1))
        : documentedType === mediaType,
    ) ?? [];
  expect(type, `${where}: media type ${mediaType} not documented`).toBeDefined();
  if (!type!.includes('json') || media?.schema === undefined) return;
  const schema = JSON.parse(
    JSON.stringify(media.schema).replaceAll('"#/components/', '"openapi#/components/'),
  );
  const validate = ajv.compile(schema);
  const valid = validate(response.body);
  expect(valid, `${where}: ${ajv.errorsText(validate.errors)}`).toBe(true);
}
