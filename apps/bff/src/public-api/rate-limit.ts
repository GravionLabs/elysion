import {
  type CanActivate,
  type ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import type { Response } from 'express';
import type { AuthenticatedRequest } from '../auth/auth.types.js';

/** One credential's count in the current window. */
export interface RateLimitDecision {
  allowed: boolean;
  limit: number;
  remaining: number;
  /** Seconds until the window starts again. */
  resetSeconds: number;
}

export interface RateLimiterOptions {
  /** Requests per window and key. */
  limit: number;
  windowMs?: number;
  /** The most keys remembered; beyond, finished windows go first, then the oldest. */
  maxKeys?: number;
  now?: () => number;
}

const WINDOW_MS = 60_000;
const MAX_KEYS = 50_000;

/**
 * The rate limit of the public API (ADR 0033): a fixed window of a minute per credential, counted in the BFF's memory. Keyed by
 * what the business backend resolved (a personal access token's id, a user's id for a Keycloak token), so a script cannot get new
 * buckets by sending made-up tokens: those never get past the guard (the edge limits them per address).
 */
export class PublicRateLimiter {
  readonly #windows = new Map<string, { start: number; count: number }>();
  readonly #limit: number;
  readonly #windowMs: number;
  readonly #maxKeys: number;
  readonly #now: () => number;

  constructor(options: RateLimiterOptions) {
    this.#limit = options.limit;
    this.#windowMs = options.windowMs ?? WINDOW_MS;
    this.#maxKeys = options.maxKeys ?? MAX_KEYS;
    this.#now = options.now ?? Date.now;
  }

  get limit(): number {
    return this.#limit;
  }

  get windowSeconds(): number {
    return Math.ceil(this.#windowMs / 1000);
  }

  /** Counts one request of `key` and says whether it may go on. A refused request counts too. */
  take(key: string): RateLimitDecision {
    const now = this.#now();
    let window = this.#windows.get(key);
    if (window === undefined || now - window.start >= this.#windowMs) {
      this.#windows.delete(key);
      this.#makeRoom(now);
      window = { start: now, count: 0 };
      this.#windows.set(key, window);
    }
    window.count += 1;
    return {
      allowed: window.count <= this.#limit,
      limit: this.#limit,
      remaining: Math.max(0, this.#limit - window.count),
      resetSeconds: Math.max(1, Math.ceil((window.start + this.#windowMs - now) / 1000)),
    };
  }

  #makeRoom(now: number): void {
    if (this.#windows.size < this.#maxKeys) return;
    for (const [key, window] of this.#windows) {
      if (now - window.start >= this.#windowMs) this.#windows.delete(key);
    }
    while (this.#windows.size >= this.#maxKeys) {
      const oldest = this.#windows.keys().next();
      if (oldest.done === true) break;
      this.#windows.delete(oldest.value);
    }
  }
}

/**
 * Applies {@link PublicRateLimiter} to every public route (part of `@PublicApi()`), after the global `AuthGuard` resolved the
 * credential. Every answer carries `RateLimit-Limit`, `RateLimit-Remaining`, `RateLimit-Reset` and `RateLimit-Policy` (the IETF
 * draft's fields); one over the limit is `429` with `Retry-After`.
 */
@Injectable()
export class PublicApiRateLimitGuard implements CanActivate {
  constructor(private readonly limiter: PublicRateLimiter) {}

  canActivate(context: ExecutionContext): boolean {
    const http = context.switchToHttp();
    const request = http.getRequest<AuthenticatedRequest>();
    const response = http.getResponse<Response>();
    const credential = request.auth?.credential;
    const key =
      credential?.tokenId != null
        ? `token:${credential.tokenId}`
        : `user:${credential?.userId ?? request.auth?.claims.sub ?? 'unknown'}`;
    const decision = this.limiter.take(key);
    response.setHeader('RateLimit-Limit', String(decision.limit));
    response.setHeader('RateLimit-Remaining', String(decision.remaining));
    response.setHeader('RateLimit-Reset', String(decision.resetSeconds));
    response.setHeader('RateLimit-Policy', `${this.limiter.limit};w=${this.limiter.windowSeconds}`);
    if (!decision.allowed) {
      response.setHeader('Retry-After', String(decision.resetSeconds));
      request.log?.warn({ reason: 'rate_limited' }, 'Public API rate limit reached');
      throw new HttpException(
        `At most ${decision.limit} requests a minute per token. Try again in ${decision.resetSeconds} s.`,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    return true;
  }
}
