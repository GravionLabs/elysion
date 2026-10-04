import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Redis } from 'ioredis';
import { REDIS_PUB_CLIENT, REDIS_SUB_CLIENT } from '../redis/redis.provider.js';

export type PresenceHandler = (message: Uint8Array) => void;

// Valkey is shared with other projects (local-infra): everything Elysion writes is namespaced.
const CHANNEL_PREFIX = 'elysion:presence:';
const STATE_KEY_PREFIX = 'elysion:presence:state:';

/**
 * Relays Yjs awareness (presence) messages between `realtime` instances via
 * Redis pub/sub, one channel per board id.
 *
 * Every message this instance publishes is tagged with its own instanceId,
 * so when Redis echoes it back on the subscription this instance ignores
 * it — its own local clients were already reached via the gateway's
 * in-memory broadcast, only *other* instances need the Redis hop.
 */
@Injectable()
export class PresenceRelay implements OnModuleDestroy {
  private readonly instanceId = randomUUID();
  private readonly handlersByBoard = new Map<string, PresenceHandler>();

  constructor(
    @Inject(REDIS_PUB_CLIENT) private readonly pub: Redis,
    @Inject(REDIS_SUB_CLIENT) private readonly sub: Redis,
  ) {
    this.sub.on('message', (channel: string, raw: string) => this.handleIncoming(channel, raw));
  }

  async publish(boardId: string, message: Uint8Array): Promise<void> {
    const envelope = JSON.stringify({
      from: this.instanceId,
      data: Buffer.from(message).toString('base64'),
    });
    await this.pub.publish(this.channelFor(boardId), envelope);
  }

  /** Idempotent: re-subscribing the same board id with a new handler replaces the old one. */
  async subscribe(boardId: string, handler: PresenceHandler): Promise<void> {
    const alreadySubscribed = this.handlersByBoard.has(boardId);
    this.handlersByBoard.set(boardId, handler);
    if (!alreadySubscribed) {
      await this.sub.subscribe(this.channelFor(boardId));
    }
  }

  /** Persists one client's current awareness state, keyed by board id + client id, so a client joining on any instance can be caught up. */
  async recordState(boardId: string, clientId: number, update: Uint8Array): Promise<void> {
    await this.pub.hset(
      this.stateKeyFor(boardId),
      String(clientId),
      Buffer.from(update).toString('base64'),
    );
  }

  /** Drops a client's persisted state — call when that client goes offline (its awareness state is set to `null`). */
  async removeState(boardId: string, clientId: number): Promise<void> {
    await this.pub.hdel(this.stateKeyFor(boardId), String(clientId));
  }

  /** All persisted per-client awareness updates for a board, each independently decodable via `applyAwarenessUpdate`. */
  async snapshot(boardId: string): Promise<Uint8Array[]> {
    const raw = await this.pub.hgetall(this.stateKeyFor(boardId));
    return Object.values(raw).map((base64) => new Uint8Array(Buffer.from(base64, 'base64')));
  }

  async onModuleDestroy(): Promise<void> {
    this.pub.disconnect();
    this.sub.disconnect();
  }

  private handleIncoming(channel: string, raw: string): void {
    if (!channel.startsWith(CHANNEL_PREFIX)) {
      return;
    }
    const boardId = channel.slice(CHANNEL_PREFIX.length);
    const handler = this.handlersByBoard.get(boardId);
    if (!handler) {
      return;
    }

    const envelope = JSON.parse(raw) as { from: string; data: string };
    if (envelope.from === this.instanceId) {
      return;
    }
    handler(new Uint8Array(Buffer.from(envelope.data, 'base64')));
  }

  private channelFor(boardId: string): string {
    return `${CHANNEL_PREFIX}${boardId}`;
  }

  private stateKeyFor(boardId: string): string {
    return `${STATE_KEY_PREFIX}${boardId}`;
  }
}
