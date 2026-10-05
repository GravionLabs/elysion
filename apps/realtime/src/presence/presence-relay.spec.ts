import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Redis } from 'ioredis';
import { FakeRedisBus, FakeRedisClient } from '../testing/fake-redis.js';
import { PRESENCE_ENTRY_TTL_MS, PresenceRelay } from './presence-relay.js';

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

  it('lets a second subscriber wait for the subscription the first one started', async () => {
    const bus = new FakeRedisBus();
    const pub = new FakeRedisClient(bus);
    const sub = new FakeRedisClient(bus);
    let activate!: () => void;
    sub.subscribe = (channel: string) =>
      new Promise<void>((resolve) => {
        activate = () => {
          sub.subscribedChannels.add(channel);
          resolve();
        };
      });
    const relay = new PresenceRelay(pub as unknown as Redis, sub as unknown as Redis);

    const first = relay.subscribe('board-1', vi.fn());
    let secondDone = false;
    const second = relay.subscribe('board-1', vi.fn()).then(() => (secondDone = true));
    await Promise.resolve();
    expect(secondDone).toBe(false); // the subscription is not active yet

    activate();
    await Promise.all([first, second]);

    expect(secondDone).toBe(true);
    expect(sub.subscribedChannels.has('elysion:presence:board-1')).toBe(true);
  });

  it('subscribes again after a failed subscription instead of staying unsubscribed', async () => {
    const bus = new FakeRedisBus();
    const pub = new FakeRedisClient(bus);
    const sub = new FakeRedisClient(bus);
    const real = sub.subscribe.bind(sub);
    let failing = true;
    sub.subscribe = async (channel: string) => {
      if (failing) throw new Error('valkey down');
      return real(channel);
    };
    const relay = new PresenceRelay(pub as unknown as Redis, sub as unknown as Redis);
    await expect(relay.subscribe('board-1', vi.fn())).rejects.toThrow('valkey down');

    failing = false;
    await relay.subscribe('board-1', vi.fn());

    expect(sub.subscribedChannels.has('elysion:presence:board-1')).toBe(true);
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

  it('stops delivering a board once it is unsubscribed, and tolerates unsubscribing twice', async () => {
    const bus = new FakeRedisBus();
    const relayA = createRelay(bus);
    const relayB = createRelay(bus);
    const received = vi.fn();
    await relayB.subscribe('board-1', received);

    await relayB.unsubscribe('board-1');
    await relayB.unsubscribe('board-1');
    await relayA.publish('board-1', new Uint8Array([1]));
    await relayB.subscribe('board-1', received); // subscribing again after an unload works
    await relayA.publish('board-1', new Uint8Array([2]));

    expect(received).toHaveBeenCalledTimes(1);
    expect(received).toHaveBeenCalledWith(new Uint8Array([2]));
  });

  it('namespaces channels and state keys with elysion: because Valkey is shared with other projects', async () => {
    const bus = new FakeRedisBus();
    const pub = new FakeRedisClient(bus);
    const sub = new FakeRedisClient(bus);
    const relay = new PresenceRelay(pub as unknown as Redis, sub as unknown as Redis);

    await relay.subscribe('board-1', vi.fn());
    await relay.recordState('board-1', 7, new Uint8Array([1]));

    expect([...sub.subscribedChannels]).toEqual(['elysion:presence:board-1']);
    expect([...pub.hashes.keys()]).toEqual(['elysion:presence:state:board-1']);
  });

  describe('state entries', () => {
    afterEach(() => vi.useRealTimers());

    function relayWithClient() {
      const pub = new FakeRedisClient(new FakeRedisBus());
      const relay = new PresenceRelay(
        pub as unknown as Redis,
        new FakeRedisClient(new FakeRedisBus()) as unknown as Redis,
      );
      return { relay, pub };
    }

    it('lets a board hash expire a day after its last write, so leaked keys do not pile up', async () => {
      const { relay, pub } = relayWithClient();

      await relay.recordState('board-1', 7, new Uint8Array([1]));

      expect(pub.expirations.get('elysion:presence:state:board-1')).toBe(24 * 60 * 60);
    });

    it('returns the entries that are still fresh', async () => {
      const { relay } = relayWithClient();

      await relay.recordState('board-1', 7, new Uint8Array([1, 2, 3]));

      expect(await relay.snapshot('board-1')).toEqual([new Uint8Array([1, 2, 3])]);
    });

    it('drops and deletes entries older than the awareness timeout, keeping refreshed ones', async () => {
      vi.useFakeTimers();
      const { relay, pub } = relayWithClient();
      await relay.recordState('board-1', 1, new Uint8Array([1]));
      await relay.recordState('board-1', 2, new Uint8Array([2]));

      vi.advanceTimersByTime(PRESENCE_ENTRY_TTL_MS - 1000);
      await relay.recordState('board-1', 2, new Uint8Array([22])); // client 2 announced itself again
      vi.advanceTimersByTime(2000);

      expect(await relay.snapshot('board-1')).toEqual([new Uint8Array([22])]);
      expect([...(pub.hashes.get('elysion:presence:state:board-1')?.keys() ?? [])]).toEqual(['2']);
    });

    it('deletes entries written before timestamps existed', async () => {
      const { relay, pub } = relayWithClient();
      await pub.hset('elysion:presence:state:board-1', '9', 'AQID'); // old format: bare base64

      expect(await relay.snapshot('board-1')).toEqual([]);
      expect(pub.hashes.get('elysion:presence:state:board-1')?.size).toBe(0);
    });
  });
});
