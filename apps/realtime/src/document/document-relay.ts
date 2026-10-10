import { Inject, Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Redis } from 'ioredis';
import { parseEnvelope, rateLimited } from '../redis/envelope.js';
import { REDIS_PUB_CLIENT, REDIS_SUB_CLIENT } from '../redis/redis.provider.js';

/**
 * What one instance tells the others about a board's document.
 * - `update`: a Yjs update to apply.
 * - `hello`: the sender (re)started following the board and sends its state vector; peers answer with
 *   what it lacks (`update`) and with their own state vector (`hello-ack`).
 * - `hello-ack`: the answer to a hello; its receiver sends back what the sender lacks, and nothing more,
 *   so an exchange ends after one round.
 */
export type DocumentMessage =
  | { readonly type: 'update'; readonly data: Uint8Array }
  | { readonly type: 'hello'; readonly data: Uint8Array }
  | { readonly type: 'hello-ack'; readonly data: Uint8Array };

export interface DocumentSubscription {
  /** A message from another instance. */
  readonly onMessage: (message: DocumentMessage) => void;
  /** The connection to Valkey came back after an outage: updates may have been missed in both directions. */
  readonly onReconnect: () => void;
}

// Valkey is shared with other projects (local-infra): everything Elysion writes is namespaced.
const CHANNEL_PREFIX = 'elysion:doc:';
const MESSAGE_TYPES: readonly string[] = ['update', 'hello', 'hello-ack'];

/**
 * Relays Yjs document updates between `realtime` instances through Valkey pub/sub, one channel per board
 * id, so two instances serving one board show the same content. Same shape as {@link PresenceRelay}
 * (instance id in every envelope so an instance ignores its own messages), with one difference: a lost
 * document update must not leave the instances diverged. Callers heal gaps with the hello exchange
 * whenever they start following a board and whenever Valkey reconnects (`onReconnect`).
 */
@Injectable()
export class DocumentRelay implements OnModuleDestroy {
  private readonly logger = new Logger(DocumentRelay.name);
  private readonly instanceId = randomUUID();
  private readonly subscriptions = new Map<string, DocumentSubscription>();
  private wasReady = false;

  constructor(
    @Inject(REDIS_PUB_CLIENT) private readonly pub: Redis,
    @Inject(REDIS_SUB_CLIENT) private readonly sub: Redis,
  ) {
    this.sub.on('message', (channel: string, raw: string) => this.handleIncoming(channel, raw));
    // 'ready' fires on the first connection and after each reconnect; only the latter means a gap.
    this.sub.on('ready', () => {
      if (this.wasReady) {
        for (const subscription of this.subscriptions.values()) subscription.onReconnect();
      }
      this.wasReady = true;
    });
  }

  async publish(boardId: string, message: DocumentMessage): Promise<void> {
    const envelope = JSON.stringify({
      from: this.instanceId,
      type: message.type,
      data: Buffer.from(message.data).toString('base64'),
    });
    await this.pub.publish(this.channelFor(boardId), envelope);
  }

  /** Idempotent: subscribing a board again replaces the earlier subscription. */
  async subscribe(boardId: string, subscription: DocumentSubscription): Promise<void> {
    const alreadySubscribed = this.subscriptions.has(boardId);
    this.subscriptions.set(boardId, subscription);
    if (!alreadySubscribed) {
      await this.sub.subscribe(this.channelFor(boardId));
    }
  }

  /** Call when the board's room is unloaded. */
  async unsubscribe(boardId: string): Promise<void> {
    if (this.subscriptions.delete(boardId)) {
      await this.sub.unsubscribe(this.channelFor(boardId));
    }
  }

  async onModuleDestroy(): Promise<void> {
    this.subscriptions.clear();
  }

  private handleIncoming(channel: string, raw: string): void {
    if (!channel.startsWith(CHANNEL_PREFIX)) {
      return;
    }
    const subscription = this.subscriptions.get(channel.slice(CHANNEL_PREFIX.length));
    if (!subscription) {
      return;
    }

    const envelope = parseEnvelope(raw, MESSAGE_TYPES);
    if (!envelope) {
      this.warnMalformed();
      return;
    }
    if (envelope.from === this.instanceId) {
      return;
    }
    subscription.onMessage({ type: envelope.type as DocumentMessage['type'], data: envelope.data });
  }

  private readonly warnMalformed = rateLimited(() =>
    this.logger.warn('Dropped a malformed message on a document relay channel'),
  );

  private channelFor(boardId: string): string {
    return `${CHANNEL_PREFIX}${boardId}`;
  }
}
