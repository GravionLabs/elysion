import { Component, computed, input, output } from '@angular/core';
import { Theme } from '../theme/theme.service';
import { ExportMenu, ExportRequest } from './export-menu';

/** The Yjs connection of the canvas, as its `status` event reports it. */
export type SyncStatus = 'connecting' | 'connected' | 'disconnected';

const STATUS_LABEL: Record<SyncStatus, string> = {
  connecting: 'Connecting…',
  connected: 'Connected',
  disconnected: 'Offline',
};

/** The bar at the top of the board page, modeled on ariadne's: identity left, actions right. */
@Component({
  imports: [ExportMenu],
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
  /** Whether anything is selected on the canvas (enables 'selection only' in the Export menu). */
  readonly hasSelection = input(false);
  /** Whether the library sidebar is open. */
  readonly libraryOpen = input(false);

  readonly themeToggle = output<void>();
  readonly libraryToggle = output<void>();
  readonly exportRequested = output<ExportRequest>();
  /** A file was picked for import; the page confirms before anything is replaced. */
  readonly importChosen = output<File>();

  protected chooseImport(event: Event): void {
    const fileInput = event.target as HTMLInputElement;
    const file = fileInput.files?.[0];
    fileInput.value = ''; // the same file can be chosen again
    if (file) {
      this.importChosen.emit(file);
    }
  }

  protected readonly title = computed(() => this.boardName() ?? this.boardId());
  protected readonly statusLabel = computed(() => STATUS_LABEL[this.status()]);
  protected readonly themeTitle = computed(() =>
    this.theme() === 'dark' ? 'Switch to the light theme' : 'Switch to the dark theme',
  );
}
