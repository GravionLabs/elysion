import { createHmac } from 'node:crypto';
import {
  type BoardRole,
  WS_TOKEN_ALGORITHM,
  WS_TOKEN_AUDIENCE,
  WS_TOKEN_ISSUER,
} from '@elysion/shared-types';

/** The secret the tests run with (set in the vitest configs, as a real deployment sets `WS_TOKEN_SECRET`). */
export const TEST_WS_TOKEN_SECRET = 'test-only-ws-token-secret-0123456789abcdef';

export interface WsTokenOptions {
  sub?: string;
  role?: BoardRole | string;
  /** Seconds from now until expiry; negative: already expired. */
  expiresIn?: number;
  secret?: string;
  issuer?: string;
  audience?: string;
  /** Leave claims out to build a malformed token. */
  omit?: Array<'sub' | 'boardId' | 'role' | 'exp'>;
  algorithm?: string;
}

const b64 = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');

/** A signed WS token, made synchronously so test URLs can be built in one expression. */
export function signWsToken(boardId: string, options: WsTokenOptions = {}): string {
  const now = Math.floor(Date.now() / 1000);
  const claims: Record<string, unknown> = {
    sub: options.sub ?? 'kc-sub-1',
    boardId,
    role: options.role ?? 'editor',
    iss: options.issuer ?? WS_TOKEN_ISSUER,
    aud: options.audience ?? WS_TOKEN_AUDIENCE,
    iat: now,
    exp: now + (options.expiresIn ?? 60),
  };
  for (const name of options.omit ?? []) delete claims[name];
  const unsigned = `${b64({ alg: options.algorithm ?? WS_TOKEN_ALGORITHM, typ: 'JWT' })}.${b64(claims)}`;
  const signature = createHmac('sha256', options.secret ?? TEST_WS_TOKEN_SECRET)
    .update(unsigned)
    .digest('base64url');
  return `${unsigned}.${signature}`;
}

/** The `/yjs` URL of a board with a valid token for it (or the token the options describe). */
export function boardUrl(baseUrl: string, boardId: string, options?: WsTokenOptions): string {
  return `${baseUrl}?board=${encodeURIComponent(boardId)}&token=${signWsToken(boardId, options)}`;
}
