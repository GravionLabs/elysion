import {
  Component,
  ElementRef,
  HostListener,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { ExportFormat } from '../board/download';

const PREPARING: Record<ExportFormat, string> = {
  png: 'PNG',
  svg: 'SVG',
  pdf: 'PDF',
  excalidraw: $localize`:@@topbar.export.preparing-file:file`,
};

export interface ExportRequest {
  format: ExportFormat;
  selectionOnly: boolean;
}

/** The Export menu of the top bar, after ariadne's: PNG, SVG, a PDF document or an .excalidraw file. */
@Component({
  selector: 'app-export-menu',
  styleUrl: './export-menu.scss',
  templateUrl: './export-menu.html',
})
export class ExportMenu {
  readonly #host = inject<ElementRef<HTMLElement>>(ElementRef);

  /** Whether anything is selected; the 'selection only' option needs it. */
  readonly hasSelection = input(false);
  /** The format being prepared (a PDF takes a moment on a large board); the items wait until it is done. */
  readonly busy = input<ExportFormat | null>(null);
  readonly exportRequested = output<ExportRequest>();

  protected readonly open = signal(false);
  protected readonly selectionOnly = signal(false);

  protected readonly formats: readonly { format: ExportFormat; label: string }[] = [
    { format: 'png', label: $localize`:@@topbar.export.png:PNG image` },
    { format: 'svg', label: $localize`:@@topbar.export.svg:SVG image` },
    { format: 'pdf', label: $localize`:@@topbar.export.pdf:PDF document` },
    { format: 'excalidraw', label: $localize`:@@topbar.export.excalidraw:Excalidraw file` },
  ];

  /** The text on the button while a file is being prepared, e.g. "Preparing PDF…". */
  protected readonly busyLabel = computed(() => {
    const format = this.busy();
    return format === null
      ? null
      : $localize`:@@topbar.export.preparing:Preparing ${PREPARING[format]}:format:…`;
  });

  protected toggle(): void {
    this.open.update((open) => !open);
  }

  protected choose(format: ExportFormat): void {
    if (this.busy() !== null) {
      return;
    }
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
