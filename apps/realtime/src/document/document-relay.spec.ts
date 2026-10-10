import { describe, expect, it, vi } from 'vitest';
import type { Redis } from 'ioredis';
import { FakeRedisBus, FakeRedisClient } from '../testing/fake-redis.js';
import { DocumentRelay } from './document-relay.js';

function createRelay(bus: FakeRedisBus) {
  const pub = new FakeRedisClient(bus);
  const sub = new FakeRedisClient(bus);
  return { relay: new DocumentRelay(pub as unknown as Redis, sub as unknown as Redis), pub, sub };
}

const subscription = () => ({ onMessage: vi.fn(), onReconnect: vi.fn() });

describe('DocumentRelay', () => {
  it('delivers a message to another instance following the same board, with its type and bytes', async () => {
    const bus = new FakeRedisBus();
    const a = createRelay(bus);
    const b = createRelay(bus);
    const followed = subscription();
    await b.relay.subscribe('board-1', followed);

    await a.relay.publish('board-1', { type: 'update', data: new Uint8Array([1, 2, 3]) });

    expect(followed.onMessage).toHaveBeenCalledWith({
      type: 'update',
      data: new Uint8Array([1, 2, 3]),
    });
  });

  it('does not hand an instance its own messages back', async () => {
    const bus = new FakeRedisBus();
    const a = createRelay(bus);
    const followed = subscription();
    await a.relay.subscribe('board-1', followed);

    await a.relay.publish('board-1', { type: 'update', data: new Uint8Array([9]) });

    expect(followed.onMessage).not.toHaveBeenCalled();
  });

  it('keeps boards apart and namespaces the channel with elysion:doc:', async () => {
    const bus = new FakeRedisBus();
    const a = createRelay(bus);
    const b = createRelay(bus);
    const followed = subscription();
    await b.relay.subscribe('board-1', followed);

    await a.relay.publish('board-2', { type: 'update', data: new Uint8Array([1]) });

    expect(followed.onMessage).not.toHaveBeenCalled();
    expect([...b.sub.subscribedChannels]).toEqual(['elysion:doc:board-1']);
  });

  it('ignores messages on channels that are not its own, such as presence', async () => {
    const bus = new FakeRedisBus();
    const b = createRelay(bus);
    const followed = subscription();
    await b.relay.subscribe('board-1', followed);

    b.sub.emit('message', 'elysion:presence:board-1', '{}');

    expect(followed.onMessage).not.toHaveBeenCalled();
  });

  it('stops delivering after unsubscribe, and tolerates unsubscribing twice', async () => {
    const bus = new FakeRedisBus();
    const a = createRelay(bus);
    const b = createRelay(bus);
    const followed = subscription();
    await b.relay.subscribe('board-1', followed);

    await b.relay.unsubscribe('board-1');
    await b.relay.unsubscribe('board-1');
    await a.relay.publish('board-1', { type: 'update', data: new Uint8Array([1]) });

    expect(followed.onMessage).not.toHaveBeenCalled();
  });

  it('reports a reconnect, but not the first connection', async () => {
    const bus = new FakeRedisBus();
    const b = createRelay(bus);
    const followed = subscription();
    await b.relay.subscribe('board-1', followed);

    b.sub.emit('ready'); // first connection
    expect(followed.onReconnect).not.toHaveBeenCalled();
    b.sub.emit('ready'); // after an outage
    expect(followed.onReconnect).toHaveBeenCalledTimes(1);
  });

  it('lets the caller see a failed publish', async () => {
    const bus = new FakeRedisBus();
    const a = createRelay(bus);
    a.pub.publish = async () => {
      throw new Error('valkey down');
    };

    await expect(a.relay.publish('b', { type: 'update', data: new Uint8Array() })).rejects.toThrow(
      'valkey down',
    );
  });

  describe('a message that is not what an instance publishes (#775)', () => {
    const attacker = (bus: FakeRedisBus) => new FakeRedisClient(bus);
    const bad: [string, string][] = [
      ['not JSON', 'not json at all'],
      ['JSON that is no object', '42'],
      ['null', 'null'],
      ['an object without data', JSON.stringify({ from: 'x', type: 'update' })],
      ['an object without a sender', JSON.stringify({ type: 'update', data: 'AQID' })],
      ['an unknown type', JSON.stringify({ from: 'x', type: 'drop-table', data: 'AQID' })],
      ['a data that is no string', JSON.stringify({ from: 'x', type: 'update', data: [1, 2] })],
    ];

    it.each(bad)('drops %s without throwing and without telling the room', async (_name, raw) => {
      const bus = new FakeRedisBus();
      const follower = createRelay(bus);
      const followed = subscription();
      await follower.relay.subscribe('board-1', followed);

      expect(() => attacker(bus).publish('elysion:doc:board-1', raw)).not.toThrow();

      expect(followed.onMessage).not.toHaveBeenCalled();
    });

    it('still delivers a good message after a bad one', async () => {
      const bus = new FakeRedisBus();
      const a = createRelay(bus);
      const b = createRelay(bus);
      const followed = subscription();
      await b.relay.subscribe('board-1', followed);

      await attacker(bus).publish('elysion:doc:board-1', '{');
      await a.relay.publish('board-1', { type: 'update', data: new Uint8Array([7]) });

      expect(followed.onMessage).toHaveBeenCalledOnce();
    });
  });
});
