import { createHash } from 'node:crypto';
import { REQUEST_ID_HEADER, currentRequestId } from '@elysion/node-logging';
import { BadGatewayException, ForbiddenException } from '@nestjs/common';

/** Who a credential of the public API is, as the business backend's `GET /me/credential` answers (ADR 0033). */
export interface Credential {
  userId: string;
  displayName: string;
  kind: 'person' | 'integration';
  /** The id of the personal access token, or `null` for a Keycloak token. */
  tokenId: string | null;
  scopes: string[];
}

export interface CredentialResolverOptions {
  /** The business backend, e.g. `http://localhost:5174`. */
  baseUrl: string;
  /** How long an answer is remembered (ms); a revoke takes effect within it. */
  ttlMs?: number;
  /** The most answers remembered; the oldest go first. */
  maxEntries?: number;
  /** The clock, for tests. */
  now?: () => number;
}

/** 30 seconds: a revoked or expired token is refused within that time at the latest (ADR 0033). */
export const CREDENTIAL_TTL_MS = 30_000;
const MAX_ENTRIES = 10_000;
const TIMEOUT_MS = 5000;

/**
 * Resolves the credential of a public API request to its user and scopes by asking the business backend, which looks a personal
 * access token up by its hash and refuses an unknown, expired or revoked one (`401`). The answer, and a refusal, is remembered for
 * `ttlMs` per token (keyed by its SHA-256, never the token itself), so a script that calls in a loop costs one backend call per
 * half minute. A deactivated person (`403 account-deactivated`) and an unreachable backend are never remembered.
 */
export class CredentialResolver {
  readonly #cache = new Map<string, { until: number; credential: Credential | null }>();
  readonly #ttlMs: number;
  readonly #maxEntries: number;
  readonly #now: () => number;

  constructor(private readonly options: CredentialResolverOptions) {
    this.#ttlMs = options.ttlMs ?? CREDENTIAL_TTL_MS;
    this.#maxEntries = options.maxEntries ?? MAX_ENTRIES;
    this.#now = options.now ?? Date.now;
  }

  /** The credential, or `null` when the backend refuses the token (`401`). `fresh` asks the backend even when an answer is remembered. */
  async resolve(token: string, { fresh = false } = {}): Promise<Credential | null> {
    const key = createHash('sha256').update(token).digest('hex');
    const remembered = this.#cache.get(key);
    if (!fresh && remembered !== undefined && remembered.until > this.#now()) {
      return remembered.credential;
    }
    const credential = await this.#ask(token);
    this.#cache.delete(key);
    if (this.#cache.size >= this.#maxEntries) {
      const oldest = this.#cache.keys().next();
      if (oldest.done !== true) this.#cache.delete(oldest.value);
    }
    this.#cache.set(key, { until: this.#now() + this.#ttlMs, credential });
    return credential;
  }

  async #ask(token: string): Promise<Credential | null> {
    const requestId = currentRequestId();
    let response: Response;
    try {
      response = await fetch(new URL('/me/credential', this.options.baseUrl), {
        headers: {
          authorization: `Bearer ${token}`,
          ...(requestId === undefined ? {} : { [REQUEST_ID_HEADER]: requestId }),
        },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch {
      throw new BadGatewayException('The business backend is not reachable.');
    }
    if (response.status === 401) {
      return null;
    }
    if (response.status === 403) {
      // A deactivated owner or integration (#668): passed on with its code, like on the browser's routes.
      const body = (await response.json().catch(() => ({}))) as { code?: unknown };
      throw new ForbiddenException({
        statusCode: 403,
        error: 'Forbidden',
        message: 'This account has been deactivated.',
        ...(typeof body.code === 'string' ? { code: body.code } : {}),
      });
    }
    if (!response.ok) {
      throw new BadGatewayException(`The business backend answered ${response.status}.`);
    }
    return credentialOf(await response.json());
  }
}

/** The answer of `/me/credential`, checked; anything else is the backend's fault. */
function credentialOf(body: unknown): Credential {
  const value = body as Partial<Credential> | null;
  if (
    typeof value?.userId !== 'string' ||
    typeof value.displayName !== 'string' ||
    (value.kind !== 'person' && value.kind !== 'integration') ||
    !Array.isArray(value.scopes) ||
    !value.scopes.every((scope) => typeof scope === 'string')
  ) {
    throw new BadGatewayException('The business backend answered an unknown credential.');
  }
  return {
    userId: value.userId,
    displayName: value.displayName,
    kind: value.kind,
    tokenId: typeof value.tokenId === 'string' ? value.tokenId : null,
    scopes: value.scopes,
  };
}
