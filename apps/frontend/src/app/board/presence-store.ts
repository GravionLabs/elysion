import { Injectable, computed, signal } from '@angular/core';

/** Another person on the board, as the canvas element's `presence` event reports them. */
export interface PresentUser {
  id: string;
  name: string;
  /** `#rrggbb`: the color of their cursor on the canvas. */
  color: string;
}

/**
 * Who else is on the board, for the parts of the shell that show it. A signal service, not a SignalStore
 * (ADR 0009). Provided by the board page, so it starts empty for each board and is gone with it.
 */
@Injectable()
export class PresenceStore {
  readonly #users = signal<readonly PresentUser[]>([]);

  /** The other people on the board; not the user themself. */
  readonly users = this.#users.asReadonly();
  readonly count = computed(() => this.#users().length);

  /**
   * Takes the list from the element's `presence` event. The event crosses a boundary between two apps, so
   * entries that are not `{ id, name, color }` strings are dropped rather than trusted.
   */
  setFromEvent(detail: unknown): void {
    const list = (detail as { users?: unknown } | null)?.users;
    this.#users.set(Array.isArray(list) ? list.filter(isPresentUser) : []);
  }

  clear(): void {
    this.#users.set([]);
  }
}

function isPresentUser(value: unknown): value is PresentUser {
  const user = value as Partial<PresentUser> | null;
  return (
    typeof user?.id === 'string' &&
    typeof user.name === 'string' &&
    typeof user.color === 'string' &&
    /^#[0-9a-f]{6}$/i.test(user.color)
  );
}
