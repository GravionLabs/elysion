/**
 * The options of the Export menu (#726): the page of a PDF, the colors, the background and the scale of a PNG. What was chosen
 * last is remembered in this browser, so that a person who exports the same way every time chooses once.
 */
export type PdfPages = 'auto' | 'whole';
export type PageFormat = 'fit' | 'a4' | 'letter';
export type PageOrientation = 'auto' | 'portrait' | 'landscape';
export type ExportColors = 'current' | 'light' | 'dark';
export type PngScale = 1 | 2 | 3;

export interface ExportSettings {
  pdfPages: PdfPages;
  pageFormat: PageFormat;
  orientation: PageOrientation;
  colors: ExportColors;
  background: boolean;
  scale: PngScale;
}

export const DEFAULT_EXPORT_SETTINGS: ExportSettings = {
  pdfPages: 'auto',
  pageFormat: 'fit',
  orientation: 'auto',
  colors: 'current',
  background: true,
  scale: 1,
};

const STORAGE_KEY = 'elysion.export-settings';

const CHOICES = {
  pdfPages: ['auto', 'whole'],
  pageFormat: ['fit', 'a4', 'letter'],
  orientation: ['auto', 'portrait', 'landscape'],
  colors: ['current', 'light', 'dark'],
  scale: [1, 2, 3],
} as const;

/** Settings from whatever was stored: a value that is not one of the choices is the default, so a stale or edited entry does no harm. */
export function parseSettings(value: unknown): ExportSettings {
  const stored = (typeof value === 'object' && value !== null ? value : {}) as Record<
    string,
    unknown
  >;
  const pick = <K extends keyof typeof CHOICES>(key: K): ExportSettings[K] => {
    const choices = CHOICES[key] as readonly unknown[];
    return (
      choices.includes(stored[key]) ? stored[key] : DEFAULT_EXPORT_SETTINGS[key]
    ) as ExportSettings[K];
  };
  return {
    pdfPages: pick('pdfPages'),
    pageFormat: pick('pageFormat'),
    orientation: pick('orientation'),
    colors: pick('colors'),
    scale: pick('scale'),
    background:
      typeof stored['background'] === 'boolean'
        ? stored['background']
        : DEFAULT_EXPORT_SETTINGS.background,
  };
}

export function loadSettings(storage: Pick<Storage, 'getItem'> = localStorage): ExportSettings {
  try {
    return parseSettings(JSON.parse(storage.getItem(STORAGE_KEY) ?? 'null'));
  } catch {
    return DEFAULT_EXPORT_SETTINGS;
  }
}

export function saveSettings(
  settings: ExportSettings,
  storage: Pick<Storage, 'setItem'> = localStorage,
): void {
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // A browser without storage still exports; it just does not remember.
  }
}

/** The options the canvas element's `exportBoard` takes. */
export function toCanvasOptions(settings: ExportSettings, selectionOnly: boolean) {
  return {
    selectionOnly,
    background: settings.background,
    theme: settings.colors,
    scale: settings.scale,
    pdfPages: settings.pdfPages,
    pageFormat: settings.pageFormat,
    orientation: settings.orientation,
  };
}
