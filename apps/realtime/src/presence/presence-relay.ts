import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Redis } from 'ioredis';
import { REDIS_PUB_CLIENT, REDIS_SUB_CLIENT } from '../redis/redis.provider.js';

export type PresenceHandler = (message: Uint8Array) => void;

const CHANNEL_PREFIX = 'presence:';

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
}
