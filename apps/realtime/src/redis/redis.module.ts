import { Global, Module } from '@nestjs/common';
import { REDIS_PUB_CLIENT, REDIS_SUB_CLIENT, createRedisClient } from './redis.provider.js';

/**
 * Two long-lived ioredis connections, shared process-wide: one for
 * publishing, one dedicated to subscriptions (a subscribed connection can't
 * issue other Redis commands, so pub/sub always needs a pair).
 */
@Global()
@Module({
  providers: [
    { provide: REDIS_PUB_CLIENT, useFactory: () => createRedisClient() },
    { provide: REDIS_SUB_CLIENT, useFactory: () => createRedisClient() },
  ],
  exports: [REDIS_PUB_CLIENT, REDIS_SUB_CLIENT],
})
export class RedisModule {}
