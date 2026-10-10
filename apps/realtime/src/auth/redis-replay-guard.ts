import { Logger } from '@nestjs/common';
import type { Redis } from 'ioredis';
import type { TokenReplayGuard } from './ws-token-verifier.js';

// Valkey is shared: everything Elysion writes is namespaced.
const KEY_PREFIX = 'elysion:wsjti:';

/**
 * Single-use WS tokens across all instances: the first `SET NX` of a token's `jti` wins. The entry lives as long as the
 * token could still be accepted, so Valkey forgets it by itself. When Valkey cannot be reached the token is let in
 * (the connection would work without Valkey: presence is optional too); the failure is logged, never the token.
 */
export class RedisReplayGuard implements TokenReplayGuard {
  private readonly logger = new Logger(RedisReplayGuard.name);

  constructor(private readonly redis: Redis) {}

  async claim(jti: string, ttlSeconds: number): Promise<boolean> {
    try {
      return (await this.redis.set(`${KEY_PREFIX}${jti}`, '1', 'EX', ttlSeconds, 'NX')) === 'OK';
    } catch (error) {
      this.logger.warn(`Single-use check of a WS token failed, letting it in: ${String(error)}`);
      return true;
    }
  }
}
