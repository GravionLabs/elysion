import { Component, ElementRef, HostListener, inject, input, output, signal } from '@angular/core';
import { ExportFormat } from '../board/download';

export interface ExportRequest {
  format: ExportFormat;
  selectionOnly: boolean;
}

/** The Export menu of the top bar, after ariadne's: PNG, SVG or an .excalidraw file. */
@Component({
  selector: 'app-export-menu',
  styleUrl: './export-menu.scss',
  templateUrl: './export-menu.html',
})
export class ExportMenu {
  readonly #host = inject<ElementRef<HTMLElement>>(ElementRef);

  /** Whether anything is selected; the 'selection only' option needs it. */
  readonly hasSelection = input(false);
  readonly exportRequested = output<ExportRequest>();

  protected readonly open = signal(false);
  protected readonly selectionOnly = signal(false);

  protected readonly formats: readonly { format: ExportFormat; label: string }[] = [
    { format: 'png', label: 'PNG image' },
    { format: 'svg', label: 'SVG image' },
    { format: 'excalidraw', label: 'Excalidraw file' },
  ];

  protected toggle(): void {
    this.open.update((open) => !open);
  }

  protected choose(format: ExportFormat): void {
    this.open.set(false);
    this.exportRequested.emit({
      format,
      selectionOnly: this.hasSelection() && this.selectionOnly(),
    });
  }

  protected setSelectionOnly(event: Event): void {
    this.selectionOnly.set((event.target as HTMLInputElement).checked);
  }

  @HostListener('document:click', ['$event'])
  protected closeOnOutsideClick(event: Event): void {
    if (this.open() && !this.#host.nativeElement.contains(event.target as Node)) {
      this.open.set(false);
    }
  }

  @HostListener('keydown.escape')
  protected closeOnEscape(): void {
    this.open.set(false);
  }
}
