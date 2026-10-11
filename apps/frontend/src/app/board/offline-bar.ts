import { Component, effect, input, output, signal } from '@angular/core';

/** After this long without a connection the bar appears: a flicker of a second or two says nothing worth a bar. */
export const OFFLINE_BAR_AFTER_MS = 10_000;
/** After this long the bar also offers a copy of the board, for someone who would rather not rely on the device. */
export const DOWNLOAD_COPY_AFTER_MS = 5 * 60_000;

/**
 * What the board page says about an outage (#735): while the connection is down the person keeps working, and the changes are kept
 * on this device and sent when it is back. The container is a polite live region that is always there, so that what appears in it
 * is announced.
 */
@Component({
  selector: 'app-offline-bar',
  styleUrl: './offline-bar.scss',
  templateUrl: './offline-bar.html',
})
export class OfflineBar {
  /** When the outage began (epoch milliseconds), or `null` while the connection is up. */
  readonly since = input<number | null>(null);
  /** The changes made on this device during the outage. */
  readonly pending = input(0);
  /** After an outage: how many changes were sent when the connection came back; `null` when there is nothing to say. */
  readonly backSent = input<number | null>(null);

  /** The person wants a copy of the board as a file. */
  readonly downloadCopy = output<void>();

  protected readonly now = signal(Date.now());

  constructor() {
    // The time is only followed while there is an outage.
    effect((onCleanup) => {
      if (this.since() === null) return;
      this.now.set(Date.now());
      const timer = setInterval(() => this.now.set(Date.now()), 1000);
      onCleanup(() => clearInterval(timer));
    });
  }

  protected offlineFor(): number {
    const since = this.since();
    return since === null ? 0 : this.now() - since;
  }

  protected showOffline(): boolean {
    return this.since() !== null && this.offlineFor() >= OFFLINE_BAR_AFTER_MS;
  }

  protected showDownload(): boolean {
    return this.showOffline() && this.offlineFor() >= DOWNLOAD_COPY_AFTER_MS;
  }
}
