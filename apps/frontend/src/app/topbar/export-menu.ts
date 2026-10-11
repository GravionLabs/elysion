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
import {
  DEFAULT_EXPORT_SETTINGS,
  type ExportColors,
  type ExportSettings,
  type PageFormat,
  type PageOrientation,
  type PdfPages,
  type PngScale,
  loadSettings,
  saveSettings,
} from './export-settings';

const PREPARING: Record<ExportFormat, string> = {
  png: 'PNG',
  svg: 'SVG',
  pdf: 'PDF',
  excalidraw: $localize`:@@topbar.export.preparing-file:file`,
};

export interface ExportRequest {
  format: ExportFormat;
  selectionOnly: boolean;
  /** What the options of the menu say; they are remembered in this browser. */
  settings: ExportSettings;
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
  protected readonly settings = signal<ExportSettings>(DEFAULT_EXPORT_SETTINGS);

  constructor() {
    this.settings.set(loadSettings());
  }

  protected readonly pdfPagesChoices: readonly { value: PdfPages; label: string }[] = [
    {
      value: 'auto',
      label: $localize`:@@topbar.export.pages.auto:One page per frame, if there are frames`,
    },
    { value: 'whole', label: $localize`:@@topbar.export.pages.whole:The whole board on one page` },
  ];
  protected readonly pageFormatChoices: readonly { value: PageFormat; label: string }[] = [
    { value: 'fit', label: $localize`:@@topbar.export.format.fit:Size of the content` },
    { value: 'a4', label: 'A4' },
    { value: 'letter', label: 'Letter' },
  ];
  protected readonly orientationChoices: readonly { value: PageOrientation; label: string }[] = [
    { value: 'auto', label: $localize`:@@topbar.export.orientation.auto:Automatic` },
    { value: 'portrait', label: $localize`:@@topbar.export.orientation.portrait:Portrait` },
    { value: 'landscape', label: $localize`:@@topbar.export.orientation.landscape:Landscape` },
  ];
  protected readonly colorChoices: readonly { value: ExportColors; label: string }[] = [
    { value: 'current', label: $localize`:@@topbar.export.colors.current:As on the screen` },
    { value: 'light', label: $localize`:@@topbar.export.colors.light:Light` },
    { value: 'dark', label: $localize`:@@topbar.export.colors.dark:Dark` },
  ];
  protected readonly scaleChoices: readonly { value: PngScale; label: string }[] = [
    { value: 1, label: '1×' },
    { value: 2, label: '2×' },
    { value: 3, label: '3×' },
  ];

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
      settings: this.settings(),
    });
  }

  /** One option was changed: it is kept for the next export, here and after a reload. */
  protected change<K extends keyof ExportSettings>(key: K, value: ExportSettings[K]): void {
    this.settings.update((settings) => ({ ...settings, [key]: value }));
    saveSettings(this.settings());
  }

  protected pick(event: Event): string {
    return (event.target as HTMLSelectElement).value;
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
