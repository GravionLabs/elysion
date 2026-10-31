/** What the reference page shows of an OpenAPI 3.1 document (docs/api/openapi.v1.json): its operations, grouped by tag. */

interface MediaObject {
  schema?: { $ref?: string; type?: string | string[] };
  example?: unknown;
  examples?: Record<string, { value?: unknown }>;
}

interface OperationObject {
  tags?: string[];
  summary?: string;
  description?: string;
  operationId?: string;
  parameters?: Array<{
    name: string;
    in: string;
    required?: boolean;
    description?: string;
    example?: unknown;
    schema?: { type?: string | string[]; format?: string; example?: unknown };
  }>;
  requestBody?: { required?: boolean; content?: Record<string, MediaObject> };
  responses?: Record<string, { description?: string; content?: Record<string, MediaObject> }>;
  'x-required-scope'?: string;
}

export interface OpenApiDocument {
  info?: { title?: string; version?: string };
  paths?: Record<string, Record<string, OperationObject>>;
}

export interface ReferenceParameter {
  name: string;
  in: string;
  required: boolean;
  type: string;
  description: string;
  example: string;
}

export interface ReferenceBody {
  mediaType: string;
  schema: string;
  example: string | null;
}

export interface ReferenceResponse {
  status: string;
  description: string;
  bodies: ReferenceBody[];
}

export interface ReferenceOperation {
  id: string;
  method: string;
  path: string;
  summary: string;
  description: string;
  scope: string | null;
  parameters: ReferenceParameter[];
  requestBody: ReferenceBody[];
  responses: ReferenceResponse[];
}

export interface ReferenceGroup {
  tag: string;
  id: string;
  operations: ReferenceOperation[];
}

const METHODS = ['get', 'post', 'put', 'patch', 'delete'];

/** A heading anchor: lower case, words joined by dashes. */
export function slug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function typeOf(
  schema: { $ref?: string; type?: string | string[]; format?: string } | undefined,
): string {
  if (schema?.$ref) return schema.$ref.split('/').at(-1) ?? '';
  const type = Array.isArray(schema?.type) ? schema.type.join(' | ') : (schema?.type ?? '');
  return schema?.format ? `${type} (${schema.format})` : type;
}

function pretty(value: unknown): string | null {
  return value === undefined ? null : JSON.stringify(value, null, 2);
}

function bodiesOf(content: Record<string, MediaObject> | undefined): ReferenceBody[] {
  return Object.entries(content ?? {}).map(([mediaType, media]) => ({
    mediaType,
    schema: typeOf(media.schema),
    example: pretty(media.example ?? Object.values(media.examples ?? {})[0]?.value),
  }));
}

/** The operations of the document grouped by their first tag, in the order the document lists them. */
export function referenceOf(document: OpenApiDocument): ReferenceGroup[] {
  const groups = new Map<string, ReferenceGroup>();
  for (const [path, item] of Object.entries(document.paths ?? {})) {
    for (const method of METHODS) {
      const operation = item[method];
      if (operation === undefined) continue;
      const tag = operation.tags?.[0] ?? 'Other';
      const group = groups.get(tag) ?? { tag, id: slug(tag), operations: [] };
      groups.set(tag, group);
      group.operations.push({
        id: slug(`${method} ${path}`),
        method: method.toUpperCase(),
        path,
        summary: operation.summary ?? '',
        description: operation.description ?? '',
        scope: operation['x-required-scope'] ?? null,
        parameters: (operation.parameters ?? []).map((parameter) => ({
          name: parameter.name,
          in: parameter.in,
          required: parameter.required === true,
          type: typeOf(parameter.schema),
          description: parameter.description ?? '',
          example: pretty(parameter.example ?? parameter.schema?.example) ?? '',
        })),
        requestBody: bodiesOf(operation.requestBody?.content),
        responses: Object.entries(operation.responses ?? {}).map(([status, response]) => ({
          status,
          description: response.description ?? '',
          bodies: bodiesOf(response.content),
        })),
      });
    }
  }
  return [...groups.values()];
}

/** Text with `code` spans as safe HTML: everything is escaped, then the backticks become `<code>`. */
export function inlineCode(text: string): string {
  const escaped = text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
  return escaped.replace(/`([^`]+)`/g, '<code>$1</code>');
}
