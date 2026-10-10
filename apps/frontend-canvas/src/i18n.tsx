import { createContext, useContext, type ReactNode } from 'react';

/** The languages of the canvas. English is the source, every other language must translate all of it. */
export const LOCALES = ['en', 'de'] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = 'en';

/** Anything but a known locale (also `null`, as `getAttribute` gives it) is English. */
export function parseLocale(value: string | null | undefined): Locale {
  return (LOCALES as readonly string[]).includes(value ?? '') ? (value as Locale) : DEFAULT_LOCALE;
}

/** The `langCode` Excalidraw knows for a locale, so its own menus, dialogs and tooltips follow. */
export function excalidrawLangCode(locale: Locale): string {
  return locale === 'de' ? 'de-DE' : 'en';
}

/**
 * Every string the canvas shows itself. This object is the source: `de` is typed as `Messages`, so a missing or an
 * extra key is a compile error. Strings with a hole are functions.
 */
export const en = {
  // Toolbar
  toolbar: 'Canvas tools',
  undo: 'Undo',
  redo: 'Redo',
  connect: 'Connect',
  connectTitle: 'Connect the two selected elements',
  toolHand: 'Hand (panning)',
  toolSelection: 'Selection',
  toolRectangle: 'Rectangle',
  toolDiamond: 'Diamond',
  toolEllipse: 'Ellipse',
  toolArrow: 'Connector',
  toolLine: 'Line',
  toolFreedraw: 'Draw',
  toolText: 'Text',
  toolImage: 'Insert image',
  toolEraser: 'Eraser',
  stickyNote: 'Sticky note',
  stickyNoteColor: 'Sticky note color',
  stickyNoteOf: (color: string) => `${color} sticky note`,
  zoomOut: 'Zoom out',
  zoomIn: 'Zoom in',
  zoomFit: 'Zoom to fit',
  zoomReset: 'Reset zoom',
  zoomResetLabel: 'Reset zoom to 100%',
  // Modifier key names in the shortcut hints
  keyCtrl: 'Ctrl',
  keyShift: 'Shift',
  // Sticky note colors
  colorYellow: 'Yellow',
  colorOrange: 'Orange',
  colorRed: 'Red',
  colorPink: 'Pink',
  colorPurple: 'Purple',
  colorBlue: 'Blue',
  colorTeal: 'Teal',
  colorGreen: 'Green',
  // Canvas menu
  canvasMenu: 'Canvas menu',
  menuView: 'View',
  menuShowGrid: 'Show grid',
  menuSnapToGrid: 'Snap to grid',
  menuSnapToObjects: 'Snap to objects',
  menuGridSize: 'Grid size',
  menuGridSizeReadOnly: 'Grid size (set by the editors)',
  menuGridSizeOption: (size: number) => `${size} px`,
  menuCanvas: 'Canvas',
  menuHelp: 'Help',
  menuClear: 'Clear canvas…',
  clearMessage: 'Remove everything from this board, for everyone? You can undo it.',
  clearAccept: 'Clear everything',
  clearDecline: 'Keep it',
  // Minimap
  minimap: 'Canvas overview',
  minimapTitle: 'Overview: click or drag to move the view',
  // Voting
  votesLeft: (left: number, total: number) =>
    `Voting: ${left} of ${total} votes left (click an element to vote)`,
  votesNone: 'Voting: no votes left (click one of your dots to take it back)',
  // Errors the host receives (as a rejection or an `error` event)
  errorReadOnly: 'This board is read-only.',
  errorNotReady: 'The canvas is not ready yet.',
  errorNotOnBoard: 'That element is not on the board.',
  libraryNotAllowed: 'Only libraries from libraries.excalidraw.com can be added.',
  libraryFailed: 'The library could not be added.',
};

export type Messages = typeof en;

export const de: Messages = {
  toolbar: 'Zeichenwerkzeuge',
  undo: 'Rückgängig',
  redo: 'Wiederholen',
  connect: 'Verbinden',
  connectTitle: 'Die beiden ausgewählten Elemente verbinden',
  toolHand: 'Hand (Ansicht verschieben)',
  toolSelection: 'Auswahl',
  toolRectangle: 'Rechteck',
  toolDiamond: 'Raute',
  toolEllipse: 'Ellipse',
  toolArrow: 'Verbindung',
  toolLine: 'Linie',
  toolFreedraw: 'Zeichnen',
  toolText: 'Text',
  toolImage: 'Bild einfügen',
  toolEraser: 'Radierer',
  stickyNote: 'Haftnotiz',
  stickyNoteColor: 'Farbe der Haftnotiz',
  stickyNoteOf: (color: string) => `Haftnotiz (${color})`,
  zoomOut: 'Verkleinern',
  zoomIn: 'Vergrößern',
  zoomFit: 'An Inhalt anpassen',
  zoomReset: 'Zoom zurücksetzen',
  zoomResetLabel: 'Zoom auf 100 % zurücksetzen',
  keyCtrl: 'Strg',
  keyShift: 'Umschalt',
  colorYellow: 'Gelb',
  colorOrange: 'Orange',
  colorRed: 'Rot',
  colorPink: 'Pink',
  colorPurple: 'Lila',
  colorBlue: 'Blau',
  colorTeal: 'Türkis',
  colorGreen: 'Grün',
  canvasMenu: 'Canvas-Menü',
  menuView: 'Ansicht',
  menuShowGrid: 'Raster anzeigen',
  menuSnapToGrid: 'Am Raster ausrichten',
  menuSnapToObjects: 'An Objekten ausrichten',
  menuGridSize: 'Rastergröße',
  menuGridSizeReadOnly: 'Rastergröße (von den Bearbeitenden festgelegt)',
  menuGridSizeOption: (size: number) => `${size} px`,
  menuCanvas: 'Canvas',
  menuHelp: 'Hilfe',
  menuClear: 'Canvas leeren…',
  clearMessage: 'Alles von diesem Board entfernen, für alle? Du kannst es rückgängig machen.',
  clearAccept: 'Alles löschen',
  clearDecline: 'Behalten',
  minimap: 'Canvas-Übersicht',
  minimapTitle: 'Übersicht: Klicken oder Ziehen, um die Ansicht zu verschieben',
  votesLeft: (left: number, total: number) =>
    `Abstimmung: noch ${left} von ${total} Stimmen übrig (zum Abstimmen ein Element anklicken)`,
  votesNone:
    'Abstimmung: keine Stimmen mehr übrig (eigenen Punkt anklicken, um die Stimme zurückzunehmen)',
  errorReadOnly: 'Dieses Board ist schreibgeschützt.',
  errorNotReady: 'Der Canvas ist noch nicht bereit.',
  errorNotOnBoard: 'Dieses Element befindet sich nicht auf dem Board.',
  libraryNotAllowed: 'Es können nur Bibliotheken von libraries.excalidraw.com hinzugefügt werden.',
  libraryFailed: 'Die Bibliothek konnte nicht hinzugefügt werden.',
};

/** The name of a sticky note color (`StickyColor.name`, which stays English: it is the stored key) in the locale. */
export function colorName(t: Messages, name: string): string {
  const key = `color${name}` as keyof Messages;
  const value = t[key];
  return typeof value === 'string' ? value : name;
}

export const DICTIONARIES: Record<Locale, Messages> = { en, de };

export interface I18n {
  locale: Locale;
  t: Messages;
  /** A zoom factor as a percentage in the locale's own notation ("100%", "100 %"). */
  percent(value: number): string;
}

export function createI18n(locale: Locale): I18n {
  return {
    locale,
    t: DICTIONARIES[locale],
    percent: (value) =>
      new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 0 }).format(value),
  };
}

const I18nContext = createContext<I18n>(createI18n(DEFAULT_LOCALE));

export function I18nProvider({ locale, children }: { locale: Locale; children: ReactNode }) {
  return <I18nContext.Provider value={createI18n(locale)}>{children}</I18nContext.Provider>;
}

/** The dictionary of the canvas' locale (English without a provider). */
export function useI18n(): I18n {
  return useContext(I18nContext);
}
