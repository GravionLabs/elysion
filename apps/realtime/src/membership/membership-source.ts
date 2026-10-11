import { REQUEST_ID_HEADER, currentRequestId } from '@elysion/node-logging';
import { BOARD_ROLES, type BoardRole } from '@elysion/shared-types';
import type { InternalTokenSigner } from '../auth/internal-token-signer.js';

/**
 * Where the realtime service learns what role a person has on a board *now*. The WS token carries the role at the
 * moment it was issued, and a socket outlives its token, so {@link MembershipWatcher} asks again while the socket is
 * open (#772).
 */
export abstract class MembershipSource {
  /**
   * The person's role on the board, or `null` when they have none any more (removed, the board deleted, or never a
   * member). Rejects when the answer cannot be had: the caller then keeps what it knows.
   */
  abstract roleOf(boardId: string, sub: string): Promise<BoardRole | null>;
}

const REQUEST_TIMEOUT_MS = 10_000;

/** The business backend's `/internal/boards/{id}/access?sub=` (ADR 0017: the service's own token, nothing else opens it). */
export class HttpMembershipSource extends MembershipSource {
  private readonly baseUrl: string;

  constructor(
    private readonly tokens: InternalTokenSigner,
    baseUrl = process.env.BUSINESS_BACKEND_URL ?? 'http://localhost:5174',
  ) {
    super();
    this.baseUrl = baseUrl.replace(/\/+$/, '');
  }

  async roleOf(boardId: string, sub: string): Promise<BoardRole | null> {
    const url = `${this.baseUrl}/internal/boards/${encodeURIComponent(boardId)}/access?sub=${encodeURIComponent(sub)}`;
    const requestId = currentRequestId();
    const response = await fetch(url, {
      headers: {
        authorization: `Bearer ${await this.tokens.sign()}`,
        ...(requestId === undefined ? {} : { [REQUEST_ID_HEADER]: requestId }),
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (response.status === 404) {
      return null;
    }
    if (response.status !== 200) {
      throw new Error(`Membership check answered ${response.status}, expected 200 or 404`);
    }
    const role = String(((await response.json()) as { role?: unknown }).role).toLowerCase();
    if (!(BOARD_ROLES as readonly string[]).includes(role)) {
      throw new Error('Membership check answered without a known role');
    }
    return role as BoardRole;
  }
}
