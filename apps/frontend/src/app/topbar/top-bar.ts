import { Component, computed, input, output } from '@angular/core';
import { Theme } from '../theme/theme.service';

/** The Yjs connection of the canvas, as its `status` event reports it. */
export type SyncStatus = 'connecting' | 'connected' | 'disconnected';

const STATUS_LABEL: Record<SyncStatus, string> = {
  connecting: 'Connecting…',
  connected: 'Connected',
  disconnected: 'Offline',
};

/** The bar at the top of the board page, modeled on ariadne's: identity left, actions right. */
@Component({
  selector: 'app-top-bar',
  styleUrl: './top-bar.scss',
  templateUrl: './top-bar.html',
})
export class TopBar {
  readonly boardId = input.required<string>();
  /** The board's name when it has one; a room without a record shows its id. */
  readonly boardName = input<string | null>(null);
  readonly status = input<SyncStatus>('connecting');
  readonly theme = input.required<Theme>();

  readonly themeToggle = output<void>();

  protected readonly title = computed(() => this.boardName() ?? this.boardId());
  protected readonly statusLabel = computed(() => STATUS_LABEL[this.status()]);
  protected readonly themeTitle = computed(() =>
    this.theme() === 'dark' ? 'Switch to the light theme' : 'Switch to the dark theme',
  );
}
