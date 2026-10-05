import { EventEmitter } from 'node:events';

/**
 * A minimal in-memory stand-in for ioredis pub/sub: publishing on any
 * client fans out to every *other* registered client subscribed to that
 * channel, mirroring how separate `realtime` instances would each hold
 * their own pub + sub connection pair against a shared real Redis.
 */
export class FakeRedisBus {
  private readonly clients = new Set<FakeRedisClient>();

  register(client: FakeRedisClient): void {
    this.clients.add(client);
  }

  publish(channel: string, message: string): void {
    for (const client of this.clients) {
      if (client.subscribedChannels.has(channel)) {
        client.emit('message', channel, message);
      }
    }
  }
}

export class FakeRedisClient extends EventEmitter {
  readonly subscribedChannels = new Set<string>();

  constructor(private readonly bus: FakeRedisBus) {
    super();
    bus.register(this);
  }

  async publish(channel: string, message: string): Promise<number> {
    this.bus.publish(channel, message);
    return 1;
  }

  async subscribe(channel: string): Promise<void> {
    this.subscribedChannels.add(channel);
  }

  async unsubscribe(channel: string): Promise<void> {
    this.subscribedChannels.delete(channel);
  }

  readonly hashes = new Map<string, Map<string, string>>();
  readonly expirations = new Map<string, number>();

  async hset(key: string, field: string, value: string): Promise<number> {
    const hash = this.hashes.get(key) ?? new Map<string, string>();
    hash.set(field, value);
    this.hashes.set(key, hash);
    return 1;
  }

  async hdel(key: string, ...fields: string[]): Promise<number> {
    const hash = this.hashes.get(key);
    return fields.filter((field) => hash?.delete(field)).length;
  }

  async hgetall(key: string): Promise<Record<string, string>> {
    return Object.fromEntries(this.hashes.get(key) ?? []);
  }

  async expire(key: string, seconds: number): Promise<number> {
    this.expirations.set(key, seconds);
    return 1;
  }

  /** Just enough of ioredis' pipeline: queued hset/expire calls run on exec(). */
  multi() {
    const queue: Array<() => Promise<unknown>> = [];
    const pipeline = {
      hset: (key: string, field: string, value: string) => {
        queue.push(() => this.hset(key, field, value));
        return pipeline;
      },
      expire: (key: string, seconds: number) => {
        queue.push(() => this.expire(key, seconds));
        return pipeline;
      },
      exec: async () => Promise.all(queue.map((run) => run())),
    };
    return pipeline;
  }

  disconnect(): void {
    // no-op
  }
}
