import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRedisClient } from './redis.provider.js';

describe('createRedisClient', () => {
  const originalUrl = process.env.REDIS_URL;

  afterEach(() => {
    if (originalUrl === undefined) {
      delete process.env.REDIS_URL;
    } else {
      process.env.REDIS_URL = originalUrl;
    }
    vi.restoreAllMocks();
  });

  it('defaults to localhost:6379 when REDIS_URL is unset', () => {
    delete process.env.REDIS_URL;
    const client = createRedisClient();
    expect(client.options.host).toBe('localhost');
    expect(client.options.port).toBe(6379);
    client.disconnect();
  });

  it('honours REDIS_URL when set', () => {
    process.env.REDIS_URL = 'redis://redis-host:6380';
    const client = createRedisClient();
    expect(client.options.host).toBe('redis-host');
    expect(client.options.port).toBe(6380);
    client.disconnect();
  });

  it('does not connect eagerly (lazyConnect)', () => {
    const client = createRedisClient();
    expect(client.status).toBe('wait');
    client.disconnect();
  });
});
