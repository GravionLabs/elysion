import { DatePipe } from '@angular/common';
import { Component, type OnInit, computed, inject, input, signal } from '@angular/core';
import type { Observable } from 'rxjs';
import { describeError } from './error-message';
import {
  type CreatedWebhook,
  WEBHOOK_EVENTS,
  type Webhook,
  type WebhookDelivery,
  WebhooksApi,
} from './webhooks-api';

interface DeliveryList {
  state: 'loading' | 'ready' | 'error';
  items: WebhookDelivery[];
}

/**
 * "Webhooks" (#853, ADR 0033, docs/webhooks.md): the endpoints that hear about a board's events (in the Share dialog, for its owners)
 * or about every board (`base` of the administration page). Add one with its URL and events, see its signing secret once, turn it
 * off and on, delete it, send a test event, and look at its last deliveries, each of which can be sent again. Collapsed, it loads
 * nothing until it is opened.
 */
@Component({
  imports: [DatePipe],
  selector: 'app-webhooks',
  styleUrl: './webhooks.scss',
  templateUrl: './webhooks.html',
})
export class Webhooks implements OnInit {
  readonly #api = inject(WebhooksApi);

  /** Where the calls go: `boardWebhooksBase(id)` or `ADMIN_WEBHOOKS_BASE`. */
  readonly base = input.required<string>();
  /** In the Share dialog the section starts closed; on its own page it is always open. */
  readonly collapsible = input(true);

  protected readonly events = WEBHOOK_EVENTS;

  protected readonly expanded = signal(false);
  protected readonly open = computed(() => !this.collapsible() || this.expanded());
  protected readonly state = signal<'idle' | 'loading' | 'ready' | 'error'>('idle');
  protected readonly webhooks = signal<Webhook[]>([]);

  protected readonly url = signal('');
  protected readonly chosen = signal<ReadonlySet<string>>(new Set());
  protected readonly creating = signal(false);
  protected readonly canCreate = computed(() => this.url().trim() !== '' && !this.creating());

  /** The webhook just made, with its secret: shown until the person closes it, never again. */
  protected readonly created = signal<CreatedWebhook | null>(null);
  protected readonly copied = signal(false);

  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly notice = signal<string | null>(null);

  /** The deliveries of the webhooks whose list is open, by webhook id. */
  protected readonly deliveries = signal<Record<string, DeliveryList>>({});

  ngOnInit(): void {
    if (!this.collapsible()) this.load();
  }

  protected toggle(): void {
    this.expanded.update((open) => !open);
    if (this.expanded() && this.state() === 'idle') this.load();
  }

  protected load(): void {
    this.state.set('loading');
    this.#api.list(this.base()).subscribe({
      next: (webhooks) => {
        this.webhooks.set(webhooks);
        this.state.set('ready');
      },
      error: () => this.state.set('error'),
    });
  }

  protected updateUrl(event: Event): void {
    this.url.set((event.target as HTMLInputElement).value);
  }

  protected toggleEvent(type: string, event: Event): void {
    const on = (event.target as HTMLInputElement).checked;
    this.chosen.update((current) => {
      const next = new Set(current);
      if (on) next.add(type);
      else next.delete(type);
      return next;
    });
  }

  protected create(): void {
    if (!this.canCreate()) return;
    this.creating.set(true);
    this.error.set(null);
    this.notice.set(null);
    this.#api
      .create(this.base(), {
        url: this.url().trim(),
        events: WEBHOOK_EVENTS.filter((type) => this.chosen().has(type)),
      })
      .subscribe({
        next: (webhook) => {
          this.creating.set(false);
          this.copied.set(false);
          this.created.set(webhook);
          this.url.set('');
          this.chosen.set(new Set());
          const { secret: _secret, ...item } = webhook;
          this.webhooks.update((list) => [...list, item]);
        },
        error: (error: unknown) => {
          this.creating.set(false);
          this.error.set(
            describeError(
              error,
              $localize`:@@webhooks.create.error:The webhook could not be added.`,
            ),
          );
        },
      });
  }

  protected async copy(secret: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(secret);
      this.copied.set(true);
    } catch {
      // No clipboard: the field selects itself on focus so the person can copy it.
      this.copied.set(false);
    }
  }

  protected selectAll(event: Event): void {
    (event.target as HTMLInputElement).select();
  }

  protected dismissCreated(): void {
    this.created.set(null);
    this.copied.set(false);
  }

  protected setEnabled(webhook: Webhook, enabled: boolean): void {
    this.#run(
      this.#api.update(this.base(), webhook.id, { enabled }),
      (updated) =>
        this.webhooks.update((list) => list.map((w) => (w.id === updated.id ? updated : w))),
      $localize`:@@webhooks.update.error:The webhook could not be changed.`,
    );
  }

  protected remove(webhook: Webhook): void {
    this.#run(
      this.#api.remove(this.base(), webhook.id),
      () => {
        this.webhooks.update((list) => list.filter((w) => w.id !== webhook.id));
        if (this.created()?.id === webhook.id) this.dismissCreated();
      },
      $localize`:@@webhooks.remove.error:The webhook could not be deleted.`,
    );
  }

  protected sendTest(webhook: Webhook): void {
    this.#run(
      this.#api.sendTest(this.base(), webhook.id),
      (delivery) => {
        this.notice.set(
          $localize`:@@webhooks.test.sent:A test event is on its way. Its delivery shows in the list below.`,
        );
        this.#prepend(webhook.id, delivery);
      },
      $localize`:@@webhooks.test.error:The test event could not be sent.`,
    );
  }

  protected toggleDeliveries(webhook: Webhook): void {
    if (this.deliveries()[webhook.id]) {
      this.deliveries.update(({ [webhook.id]: _closed, ...rest }) => rest);
      return;
    }
    this.loadDeliveries(webhook);
  }

  protected loadDeliveries(webhook: Webhook): void {
    this.#setDeliveries(webhook.id, { state: 'loading', items: [] });
    this.#api.deliveries(this.base(), webhook.id).subscribe({
      next: (items) => this.#setDeliveries(webhook.id, { state: 'ready', items }),
      error: () => this.#setDeliveries(webhook.id, { state: 'error', items: [] }),
    });
  }

  protected redeliver(webhook: Webhook, delivery: WebhookDelivery): void {
    this.#run(
      this.#api.redeliver(this.base(), webhook.id, delivery.id),
      (copy) => this.#prepend(webhook.id, copy),
      $localize`:@@webhooks.redeliver.error:The delivery could not be sent again.`,
    );
  }

  protected eventsText(webhook: Webhook): string {
    return webhook.events.length === 0
      ? $localize`:@@webhooks.events.all:all events`
      : webhook.events.join(', ');
  }

  protected statusLabel(delivery: WebhookDelivery): string {
    switch (delivery.status) {
      case 'succeeded':
        return $localize`:@@webhooks.status.succeeded:delivered`;
      case 'failed':
        return $localize`:@@webhooks.status.failed:failed`;
      default:
        return $localize`:@@webhooks.status.pending:pending`;
    }
  }

  protected describeEvent(type: string): string {
    switch (type) {
      case 'board.created':
        return $localize`:@@webhooks.event.boardCreated:A board was created`;
      case 'board.renamed':
        return $localize`:@@webhooks.event.boardRenamed:The board was renamed`;
      case 'board.deleted':
        return $localize`:@@webhooks.event.boardDeleted:The board was deleted`;
      case 'board.content.changed':
        return $localize`:@@webhooks.event.contentChanged:The content changed (at most once a minute)`;
      case 'member.added':
        return $localize`:@@webhooks.event.memberAdded:A member was added`;
      case 'member.removed':
        return $localize`:@@webhooks.event.memberRemoved:A member was removed`;
      case 'member.role_changed':
        return $localize`:@@webhooks.event.memberRoleChanged:The role of a member changed`;
      case 'snapshot.created':
        return $localize`:@@webhooks.event.snapshotCreated:A version was saved`;
      default:
        return type;
    }
  }

  protected deliveriesLabel(webhook: Webhook): string {
    return $localize`:@@webhooks.deliveries.aria:Last deliveries to ${webhook.url}:url:`;
  }

  #prepend(webhookId: string, delivery: WebhookDelivery): void {
    const current = this.deliveries()[webhookId];
    if (current?.state === 'ready') {
      this.#setDeliveries(webhookId, { state: 'ready', items: [delivery, ...current.items] });
    }
  }

  #setDeliveries(webhookId: string, list: DeliveryList): void {
    this.deliveries.update((all) => ({ ...all, [webhookId]: list }));
  }

  #run<T>(call: Observable<T>, done: (value: T) => void, fallback: string): void {
    if (this.busy()) return;
    this.busy.set(true);
    this.error.set(null);
    this.notice.set(null);
    call.subscribe({
      next: (value) => {
        this.busy.set(false);
        done(value);
      },
      error: (error: unknown) => {
        this.busy.set(false);
        this.error.set(describeError(error, fallback));
      },
    });
  }
}
