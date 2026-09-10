import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import type { Redis } from 'ioredis';
import { PresenceRelay } from './presence-relay.js';

/**
 * A minimal in-memory stand-in for ioredis pub/sub: publishing on any
 * client fans out to every *other* registered client subscribed to that
 * channel, mirroring how separate `realtime` instances would each hold
 * their own pub + sub connection pair against a shared real Redis.
 */
class FakeRedisBus {
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

class FakeRedisClient extends EventEmitter {
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

  disconnect(): void {
    // no-op
  }
}

function createRelay(bus: FakeRedisBus): PresenceRelay {
  const pub = new FakeRedisClient(bus);
  const sub = new FakeRedisClient(bus);
  return new PresenceRelay(pub as unknown as Redis, sub as unknown as Redis);
}

describe('PresenceRelay', () => {
  it('delivers a published message to another instance subscribed to the same board', async () => {
    const bus = new FakeRedisBus();
    const relayA = createRelay(bus);
    const relayB = createRelay(bus);
    const received = vi.fn();

    await relayB.subscribe('board-1', received);
    await relayA.publish('board-1', new Uint8Array([1, 2, 3]));

    expect(received).toHaveBeenCalledTimes(1);
    expect(received).toHaveBeenCalledWith(new Uint8Array([1, 2, 3]));
  });

  it('does not deliver an instance its own published message back', async () => {
    const bus = new FakeRedisBus();
    const relayA = createRelay(bus);
    const received = vi.fn();

    await relayA.subscribe('board-1', received);
    await relayA.publish('board-1', new Uint8Array([9]));

    expect(received).not.toHaveBeenCalled();
  });

  it('keeps different boards independent', async () => {
    const bus = new FakeRedisBus();
    const relayA = createRelay(bus);
    const relayB = createRelay(bus);
    const received = vi.fn();

    await relayB.subscribe('board-1', received);
    await relayA.publish('board-2', new Uint8Array([7]));

    expect(received).not.toHaveBeenCalled();
  });

  it('re-subscribing the same board replaces the handler rather than stacking calls', async () => {
    const bus = new FakeRedisBus();
    const relayA = createRelay(bus);
    const relayB = createRelay(bus);
    const first = vi.fn();
    const second = vi.fn();

    await relayB.subscribe('board-1', first);
    await relayB.subscribe('board-1', second);
    await relayA.publish('board-1', new Uint8Array([1]));

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });
});
