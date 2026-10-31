import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, type OpenAPIObject, SwaggerModule } from '@nestjs/swagger';
import { CredentialResolver } from '../auth/credential-resolver.js';
import { BusinessBackendClient } from '../boards/business-backend.client.js';
import { PUBLIC_API_CONTROLLERS } from './public-api.module.js';
import { PublicRateLimiter } from './rate-limit.js';

/** Where the committed document lives, relative to the repository's root (ADR 0033). */
export const OPENAPI_DOCUMENT_PATH = 'docs/api/openapi.v1.json';

/**
 * Only the public controllers, with stand-ins for what they need: the document is made from their decorators, and in preview mode
 * nothing is created or called, so it needs no configuration, no backend and no network.
 */
@Module({
  controllers: PUBLIC_API_CONTROLLERS,
  providers: [
    { provide: BusinessBackendClient, useValue: {} },
    { provide: CredentialResolver, useValue: {} },
    { provide: PublicRateLimiter, useValue: {} },
  ],
})
class OpenApiModule {}

const DESCRIPTION = `The versioned API of Elysion for scripts and integrations (ADR 0033). How to get a token and make the first call: \
docs/api.md.

- **Authentication**: \`Authorization: Bearer <token>\` with a personal access token (\`elp_...\`), an integration's Keycloak token \
or a person's own Keycloak token. A token acts as its person or integration and never sees more; each route also needs a scope.
- **Errors** are problem details (RFC 9457, \`application/problem+json\`).
- **Lists** are pages: \`?limit=\` (1 to 200, default 50) and \`?cursor=\` (the \`next\` of the page before; \`null\` on the last page).
- **Rate limit**: per credential, 600 requests a minute by default; every answer has \`RateLimit-Limit\`, \`RateLimit-Remaining\` and \
\`RateLimit-Reset\`, a refused one \`429\` with \`Retry-After\`.
- **Bodies** are JSON of at most 1 MiB.
- **Not in v1**: writing elements; renaming, deleting and restoring versions and opening one as a new board; webhooks.`;

/** The OpenAPI 3.1 document of the public API, made from the controllers' decorators. */
export async function buildOpenApiDocument(): Promise<OpenAPIObject> {
  const app = await NestFactory.create(OpenApiModule, {
    preview: true,
    logger: false,
    abortOnError: false,
  });
  try {
    const config = new DocumentBuilder()
      .setTitle('Elysion public API')
      .setDescription(DESCRIPTION)
      .setVersion('1')
      .setOpenAPIVersion('3.1.0')
      .addBearerAuth({
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'elp_... or JWT',
        description: 'A personal access token (`elp_...`) or a Keycloak access token.',
      })
      .build();
    const document = SwaggerModule.createDocument(app, config, {
      operationIdFactory: (controller, method) =>
        `${controller.replace(/^Public|Controller$/g, '')}_${method}`,
    });
    return toOpenApi31(document) as OpenAPIObject;
  } finally {
    await app.close();
  }
}

/**
 * OpenAPI 3.1 has no `nullable`: a schema that may be null lists `"null"` among its types (JSON Schema 2020-12), which validators
 * of the contract understand.
 */
export function toOpenApi31(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(toOpenApi31);
  if (typeof value !== 'object' || value === null) return value;
  const { nullable, ...rest } = value as Record<string, unknown>;
  const converted = Object.fromEntries(
    Object.entries(rest).map(([key, inner]) => [
      key,
      key === 'example' || key === 'examples' ? inner : toOpenApi31(inner),
    ]),
  );
  if (nullable === true && typeof converted.type === 'string') {
    converted.type = [converted.type, 'null'];
  }
  return converted;
}

/** The document as it is committed: two spaces, a final newline. */
export function serializeOpenApiDocument(document: OpenAPIObject): string {
  return `${JSON.stringify(document, null, 2)}\n`;
}
