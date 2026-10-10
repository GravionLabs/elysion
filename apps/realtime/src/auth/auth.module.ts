import { Global, Module } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { loadConfig } from '../config/config.js';
import { REDIS_PUB_CLIENT } from '../redis/redis.provider.js';
import { RedisReplayGuard } from './redis-replay-guard.js';
import { WsTokenVerifier } from './ws-token-verifier.js';

/**
 * The WS token check for the `/yjs` handshake. The secret comes from `WS_TOKEN_SECRET`; without it the app does not
 * start. A token with a `jti` is single-use (Valkey remembers it for the rest of its life).
 */
@Global()
@Module({
  providers: [
    {
      provide: WsTokenVerifier,
      inject: [REDIS_PUB_CLIENT],
      useFactory: (redis: Redis) =>
        new WsTokenVerifier(loadConfig(process.env).wsTokenSecret, new RedisReplayGuard(redis)),
    },
  ],
  exports: [WsTokenVerifier],
})
export class AuthModule {}
