import { Injectable } from '@nestjs/common';
import {
  type WsTokenClaims,
  type WsTokenResponse,
  WS_TOKEN_ALGORITHM,
  WS_TOKEN_AUDIENCE,
  WS_TOKEN_ISSUER,
} from '@elysion/shared-types';
import { SignJWT } from 'jose';
import { AppConfigService } from '../config/config.module.js';

/**
 * Makes WS tokens (docs/specs/identity.md): HS256 with `WS_TOKEN_SECRET`, valid for `WS_TOKEN_TTL_SECONDS`, for
 * one board and one role. The realtime service verifies them with the same secret, without calling back here,
 * so a handshake does not depend on the BFF being reachable. This class only signs: whether the user may
 * have a token for the board is decided before, by the caller.
 */
@Injectable()
export class WsTokenService {
  private readonly secret: Uint8Array;
  private readonly ttlSeconds: number;

  constructor(config: AppConfigService) {
    this.secret = new TextEncoder().encode(config.get('WS_TOKEN_SECRET'));
    this.ttlSeconds = config.get('WS_TOKEN_TTL_SECONDS');
  }

  async issue(claims: WsTokenClaims, now: Date = new Date()): Promise<WsTokenResponse> {
    const issuedAt = Math.floor(now.getTime() / 1000);
    const expiresAt = issuedAt + this.ttlSeconds;
    const token = await new SignJWT({ boardId: claims.boardId, role: claims.role })
      .setProtectedHeader({ alg: WS_TOKEN_ALGORITHM })
      .setSubject(claims.sub)
      .setIssuer(WS_TOKEN_ISSUER)
      .setAudience(WS_TOKEN_AUDIENCE)
      .setIssuedAt(issuedAt)
      .setExpirationTime(expiresAt)
      .sign(this.secret);
    return { token, expiresAt: new Date(expiresAt * 1000).toISOString() };
  }
}
