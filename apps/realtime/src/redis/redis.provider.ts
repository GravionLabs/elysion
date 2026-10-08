import { Redis } from 'ioredis';

export const REDIS_PUB_CLIENT = Symbol('REDIS_PUB_CLIENT');
export const REDIS_SUB_CLIENT = Symbol('REDIS_SUB_CLIENT');

/**
 * `REDIS_URL` mirrors the `valkey` service in docker-compose.yml (published on 6380 by docker-compose.dev.yml, hence apps/realtime/.env.example).
 * `lazyConnect` defers the actual TCP connection until the first command
 * (including `subscribe`), so constructing this client never blocks app
 * startup or tests on Redis being reachable.
 */
export function createRedisClient(): Redis {
  const url = process.env.REDIS_URL ?? 'redis://localhost:6379';
  return new Redis(url, { lazyConnect: true });
}
