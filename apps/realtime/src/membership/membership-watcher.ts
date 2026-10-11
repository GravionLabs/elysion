import { WS_CLOSE_FORBIDDEN } from '@elysion/shared-types';
import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import type { WebSocket } from 'ws';
import { YjsRoomRegistry } from '../yjs/yjs-room-registry.js';
import { MembershipSource } from './membership-source.js';

export interface MembershipOptions {
  /** How often every open connection's role is checked again; `0` switches the check off. */
  readonly intervalMs: number;
}

export const MEMBERSHIP_OPTIONS = Symbol('MEMBERSHIP_OPTIONS');

/** Longest a removed member can keep a socket: the check runs this often. */
export const DEFAULT_RECHECK_MS = 15_000;

/** How many people are asked about at the same time. */
const CONCURRENCY = 8;

/** The default, with `MEMBERSHIP_RECHECK_MS` (milliseconds, `0` is off) overriding it. */
export function membershipOptionsFromEnv(): MembershipOptions {
  const raw = process.env.MEMBERSHIP_RECHECK_MS?.trim();
  const value = raw ? Number(raw) : Number.NaN;
  return { intervalMs: Number.isFinite(value) && value >= 0 ? value : DEFAULT_RECHECK_MS };
}

/**
 * The WS token proves the role a person had when it was issued (60 seconds at most); an open socket lives much longer.
 * So that a removed member, a demoted editor or a deleted board cannot keep an open socket (#772), this asks the
 * business backend about every person on every board of this instance each {@link MembershipOptions.intervalMs}, once
 * per person and board however many sockets they have, and then:
 *
 * - no role any more: the person's sockets are closed with 4403, so the client's reconnect asks the BFF for a new token
 *   and is told no;
 * - another role: the sockets get it at once (a viewer's writes are dropped from the next message on);
 * - the backend cannot be reached: nothing changes, and the next round tries again. Document persistence needs the
 *   backend as well, so a longer outage ends the session anyway; closing everybody on a blip would be worse.
 *
 * Each instance checks its own sockets, so this needs no coordination between instances.
 */
@Injectable()
export class MembershipWatcher implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MembershipWatcher.name);
  private timer: NodeJS.Timeout | undefined;
  private running = false;

  constructor(
    private readonly registry: YjsRoomRegistry,
    private readonly source: MembershipSource,
    @Inject(MEMBERSHIP_OPTIONS) private readonly options: MembershipOptions,
  ) {}

  onModuleInit(): void {
    if (this.options.intervalMs > 0) {
      this.timer = setInterval(() => void this.check(), this.options.intervalMs);
      this.timer.unref();
    }
  }

  onModuleDestroy(): void {
    clearInterval(this.timer);
  }

  /** One round over every room; a round that is still running when the next is due is skipped. */
  async check(): Promise<void> {
    if (this.running) {
      return;
    }
    this.running = true;
    try {
      const work: Array<() => Promise<void>> = [];
      for (const room of this.registry.activeRooms()) {
        const socketsBySub = new Map<string, WebSocket[]>();
        for (const socket of room.clients) {
          const member = room.memberBySocket.get(socket);
          if (member) {
            socketsBySub.set(member.sub, [...(socketsBySub.get(member.sub) ?? []), socket]);
          }
        }
        for (const [sub, sockets] of socketsBySub) {
          work.push(() => this.checkOne(room, sub, sockets));
        }
      }
      for (let i = 0; i < work.length; i += CONCURRENCY) {
        await Promise.all(work.slice(i, i + CONCURRENCY).map((run) => run()));
      }
    } finally {
      this.running = false;
    }
  }

  private async checkOne(
    room: { boardId: string; memberBySocket: Map<WebSocket, { sub: string; role: string }> },
    sub: string,
    sockets: readonly WebSocket[],
  ): Promise<void> {
    let role;
    try {
      role = await this.source.roleOf(room.boardId, sub);
    } catch (error) {
      this.logger.warn(
        { boardId: room.boardId, userId: sub },
        `Membership check failed, keeping the connection: ${String(error)}`,
      );
      return;
    }
    for (const socket of sockets) {
      const member = room.memberBySocket.get(socket);
      if (!member) {
        continue; // went away while we asked
      }
      if (role === null) {
        this.logger.log(
          { boardId: room.boardId, userId: sub, closeCode: WS_CLOSE_FORBIDDEN },
          'WebSocket connection closed: the person has no role on the board any more',
        );
        socket.close(WS_CLOSE_FORBIDDEN, 'No longer a member of this board');
      } else if (member.role !== role) {
        this.logger.log(
          { boardId: room.boardId, userId: sub, from: member.role, to: role },
          'Role of an open connection changed',
        );
        room.memberBySocket.set(socket, { sub: member.sub, role });
      }
    }
  }
}
