import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type { Observable } from 'rxjs';

/** The events a webhook can receive (ADR 0033, docs/webhooks.md), in the order the form lists them. */
export const WEBHOOK_EVENTS = [
  'board.created',
  'board.renamed',
  'board.deleted',
  'board.content.changed',
  'member.added',
  'member.removed',
  'member.role_changed',
  'snapshot.created',
] as const;

/** An endpoint that receives the events of one board, or of every board when `boardId` is null (an administrator's). */
export interface Webhook {
  id: string;
  boardId: string | null;
  url: string;
  /** The events it receives; empty means all of them. */
  events: string[];
  enabled: boolean;
  disabledAt: string | null;
  /** Why it was turned off (24 hours of failed deliveries), or null. */
  disabledReason: string | null;
  createdAt: string;
  /** The start of the signing secret, to tell secrets apart; never the secret. */
  secretPrefix: string;
}

/** The answer to making a webhook: the one time `secret` is shown. */
export interface CreatedWebhook extends Webhook {
  secret: string;
}

export interface NewWebhook {
  url: string;
  events: string[];
}

export interface WebhookPatch {
  url?: string;
  events?: string[];
  enabled?: boolean;
}

/** One delivery of an event to an endpoint: the last 50 of each are kept. */
export interface WebhookDelivery {
  id: string;
  eventId: string;
  eventType: string;
  status: 'pending' | 'succeeded' | 'failed';
  attempts: number;
  responseStatus: number | null;
  durationMs: number | null;
  error: string | null;
  createdAt: string;
  lastAttemptAt: string | null;
  nextAttemptAt: string | null;
}

/** Where the webhooks of a board are (its owners), and where the administrators' webhooks for every board are. */
export const boardWebhooksBase = (boardId: string) =>
  `/api/boards/${encodeURIComponent(boardId)}/webhooks`;
export const ADMIN_WEBHOOKS_BASE = '/api/admin/webhooks';

/**
 * The webhooks of a board or of the instance (#853): the same calls under two bases (`boardWebhooksBase`, `ADMIN_WEBHOOKS_BASE`).
 * The business backend decides who may use which.
 */
@Injectable({ providedIn: 'root' })
export class WebhooksApi {
  readonly #http = inject(HttpClient);

  list(base: string): Observable<Webhook[]> {
    return this.#http.get<Webhook[]>(base);
  }

  create(base: string, webhook: NewWebhook): Observable<CreatedWebhook> {
    return this.#http.post<CreatedWebhook>(base, webhook);
  }

  update(base: string, id: string, patch: WebhookPatch): Observable<Webhook> {
    return this.#http.patch<Webhook>(`${base}/${encodeURIComponent(id)}`, patch);
  }

  remove(base: string, id: string): Observable<void> {
    return this.#http.delete<void>(`${base}/${encodeURIComponent(id)}`);
  }

  sendTest(base: string, id: string): Observable<WebhookDelivery> {
    return this.#http.post<WebhookDelivery>(`${base}/${encodeURIComponent(id)}/test`, {});
  }

  deliveries(base: string, id: string): Observable<WebhookDelivery[]> {
    return this.#http.get<WebhookDelivery[]>(`${base}/${encodeURIComponent(id)}/deliveries`);
  }

  redeliver(base: string, id: string, deliveryId: string): Observable<WebhookDelivery> {
    return this.#http.post<WebhookDelivery>(
      `${base}/${encodeURIComponent(id)}/deliveries/${encodeURIComponent(deliveryId)}/redeliver`,
      {},
    );
  }
}
