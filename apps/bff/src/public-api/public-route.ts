import { STATUS_CODES } from 'node:http';
import { applyDecorators, type Type } from '@nestjs/common';
import {
  ApiExtension,
  ApiExtraModels,
  ApiOperation,
  ApiResponse,
  type ApiResponseOptions,
  getSchemaPath,
} from '@nestjs/swagger';
import { type ApiScope, RequireScope } from '../auth/public-api.js';
import { Problem } from './dto.js';
import { PROBLEM_CONTENT_TYPE } from './problem-details.js';

/** The errors every public route can answer: no or a refused credential, a missing scope, the rate limit, the backend down. */
const COMMON_ERRORS = [401, 403, 429, 502] as const;

const ERROR_TEXT: Record<number, string> = {
  400: 'The request is malformed: a field of the wrong type, a bad `limit` or `cursor`, a name the rules refuse.',
  401: 'No credential, or one that is unknown, expired or revoked.',
  403: 'The credential lacks the scope, the role on the board or room is too low, or its owner was deactivated (`code: account-deactivated`).',
  404: 'No such board, room, member or version, or one the caller may not see (the two are not told apart).',
  409: 'The change breaks a rule: of the member list (already a member, the last owner), or of webhooks (at most ten, a delivery still being sent).',
  410: 'The stored version is gone.',
  412: 'The board changed since it was read: `If-Match` names an old `ETag`.',
  413: 'The body is larger than 1 MiB.',
  428: 'Send `If-Match` with the `ETag` of the board (or `*`).',
  429: 'Over the rate limit of the token; `Retry-After` says when to try again.',
  502: 'The business backend failed or is not reachable.',
  503: 'The object store of the versions is not available.',
};

const RATE_LIMIT_HEADERS = {
  'RateLimit-Limit': {
    description: 'Requests a minute the credential may make.',
    schema: { type: 'integer' },
  },
  'RateLimit-Remaining': {
    description: 'Requests left in the current minute.',
    schema: { type: 'integer' },
  },
  'RateLimit-Reset': {
    description: 'Seconds until the minute starts again.',
    schema: { type: 'integer' },
  },
};

export interface PublicRouteOptions {
  /** The scope the route needs; none: any valid credential. */
  scope?: ApiScope;
  summary: string;
  description?: string;
  /** The answer on success: its status, its schema (none for `204`) and an example. */
  status: 200 | 201 | 202 | 204;
  type?: Type<unknown>;
  example?: unknown;
  /** A success whose body is bytes (a file): its media type range. */
  binary?: string;
  /** Response headers of the success besides the rate limit ones (`ETag`, `Location`). */
  headers?: Record<string, { description: string; schema: { type: string } }>;
  /** The errors this route answers besides 401, 403, 429 and 502. */
  errors?: number[];
}

/** The body of the success: bytes of a media type, JSON of a schema with its example, or none (`204`). */
function successContent(options: PublicRouteOptions): { content?: object } {
  if (options.binary !== undefined) {
    return {
      content: {
        [options.binary]: { schema: { type: 'string', contentMediaType: options.binary } },
      },
    };
  }
  if (options.type === undefined) return {};
  return {
    content: {
      'application/json': {
        schema: { $ref: getSchemaPath(options.type) },
        example: options.example,
      },
    },
  };
}

/**
 * A route of the public API (ADR 0033): its scope (`@RequireScope`, checked by the guard) and its OpenAPI description, so the
 * document says the same as the code. The scope is in the description and in the extension `x-required-scope`.
 */
export function PublicRoute(options: PublicRouteOptions) {
  const scopeText =
    options.scope === undefined ? 'Needs no scope.' : `Needs the scope \`${options.scope}\`.`;
  const decorators = [
    ApiOperation({
      summary: options.summary,
      description: [options.description, scopeText].filter(Boolean).join('\n\n'),
    }),
    ApiExtraModels(Problem),
    ApiResponse({
      status: options.status,
      description: STATUS_CODES[options.status] ?? '',
      headers: { ...RATE_LIMIT_HEADERS, ...options.headers },
      ...successContent(options),
    } as ApiResponseOptions),
    ...(options.type === undefined ? [] : [ApiExtraModels(options.type)]),
    ...[...new Set([...(options.errors ?? []), ...COMMON_ERRORS])]
      .sort((a, b) => a - b)
      .map((status) =>
        ApiResponse({
          status,
          description: ERROR_TEXT[status] ?? STATUS_CODES[status] ?? '',
          content: {
            [PROBLEM_CONTENT_TYPE]: {
              schema: { $ref: getSchemaPath(Problem) },
              example: {
                type: 'about:blank',
                title: STATUS_CODES[status],
                status,
              },
            },
          },
        }),
      ),
  ];
  if (options.scope !== undefined) {
    decorators.unshift(
      RequireScope(options.scope),
      ApiExtension('x-required-scope', options.scope),
    );
  }
  return applyDecorators(...decorators);
}
