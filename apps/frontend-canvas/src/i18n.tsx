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
  legacyVotingClosed: (name: string, top: Array<{ label: string; count: number }>) =>
    `The voting${name ? ` “${name}”` : ''} was closed by an update.${
      top.length
        ? ` Result: ${top.map((entry) => `${entry.label} (${entry.count})`).join(', ')}.`
        : ''
    }`,
  // Comments (#733)
  toolComments: 'Comments',
  toolCommentsTitle: 'Comments: click an element or a point to comment on it',
  commentsPanel: 'Comments',
  commentsClose: 'Close the comments',
  commentsEmpty: 'No comments yet.',
  commentsPlaceHint: 'Click an element or a point on the board to comment on it. Esc stops.',
  commentsNew: 'New comment',
  commentsOpenHeading: (count: number) => `Open (${count})`,
  commentsResolvedHeading: (count: number) => `Resolved (${count})`,
  commentOnElement: 'On an element',
  commentOnPoint: 'On a point of the board',
  commentElementGone: 'The element is gone',
  commentPlaceholder: 'Write a comment… (@ mentions someone)',
  replyPlaceholder: 'Reply…',
  commentSend: 'Comment',
  replySend: 'Reply',
  commentCancel: 'Cancel',
  commentResolve: 'Resolve',
  commentReopen: 'Reopen',
  commentDelete: 'Delete',
  commentDeleteLabel: (author: string) => `Delete the comment of ${author}`,
  commentShow: 'Show on the board',
  commentResolvedBy: (name: string) => `Resolved by ${name}`,
  commentMarker: (count: number, resolved: boolean) =>
    `${count === 1 ? '1 comment' : `${count} comments`}${resolved ? ', resolved' : ''}`,
  commentCharactersLeft: (left: number) => `${left} characters left`,
  commentMentions: 'People',
  commentTooLong: (max: number) => `A comment can have up to ${max} characters.`,
  commentTooMany: 'There are too many comments on this board or in this thread.',
  commentFailed: 'The comment could not be saved.',
  commentsAppendixTitle: 'Comments',
  commentsAppendixOpen: 'Open',
  commentsAppendixResolved: 'Resolved',
  commentsAppendixOnElement: (label: string) => `On ${label}`,
  commentsAppendixOnPoint: 'On a point of the board',
  // Errors the host receives (as a rejection or an `error` event)
  errorReadOnly: 'This board is read-only.',
  errorBusy: 'Another import is still open.',
  errorNotReady: 'The canvas is not ready yet.',
  errorNotOnBoard: 'That element is not on the board.',
  libraryNotAllowed: 'Only libraries from libraries.excalidraw.com can be added.',
  libraryFailed: 'The library could not be added.',
  imageTypeNotSupported: (name: string) =>
    `${name} was not added: only PNG, JPEG, GIF, WebP and SVG images can be.`,
  imageTooLarge: (name: string) => `${name} was not added: it is larger than 4 MB.`,
  imageUnreadable: (name: string) => `${name} was not added: it could not be read as an image.`,
  pdfTitle: (name: string) => `Bring ${name} onto the board`,
  pdfLoading: 'Reading the PDF…',
  pdfSelectAll: 'All pages',
  pdfSelectNone: 'No page',
  pdfSharpness: 'Sharpness',
  pdfWidthOption: (px: number) => `${px} px wide`,
  pdfPagesLabel: 'Pages',
  pdfPageName: (page: number) => `Page ${page}`,
  pdfImportButton: (count: number) => (count === 1 ? 'Import 1 page' : `Import ${count} pages`),
  pdfCancel: 'Cancel',
  pdfProgress: (done: number, total: number) => `Page ${done} of ${total}`,
  pdfTooManyPages: (count: number, max: number) =>
    `The PDF has ${count} pages; the first ${max} can be imported.`,
  pdfEncrypted: (name: string) => `${name} is protected by a password and cannot be read.`,
  pdfInvalid: (name: string) => `${name} could not be read as a PDF.`,
  pdfTooLarge: (name: string) => `${name} is larger than 10 MB.`,
  pdfPagesSkipped: (pages: string) =>
    `Pages ${pages} are too large to become a picture and were left out.`,
  pdfImported: (count: number) => (count === 1 ? 'Imported 1 page.' : `Imported ${count} pages.`),
  pdfNeedsImages: 'This board cannot take pictures, so it cannot take a PDF.',
  boardFull: 'This board is full: 20,000 elements.',
  boardFullServer: 'This board is full. Delete something to make room.',
  updateTooLarge: 'That change is too large to send.',
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
  legacyVotingClosed: (name: string, top: Array<{ label: string; count: number }>) =>
    `Die Abstimmung${name ? ` „${name}“` : ''} wurde durch ein Update beendet.${
      top.length
        ? ` Ergebnis: ${top.map((entry) => `${entry.label} (${entry.count})`).join(', ')}.`
        : ''
    }`,
  errorReadOnly: 'Dieses Board ist schreibgeschützt.',
  errorBusy: 'Ein anderer Import ist noch offen.',
  errorNotReady: 'Der Canvas ist noch nicht bereit.',
  errorNotOnBoard: 'Dieses Element befindet sich nicht auf dem Board.',
  libraryNotAllowed: 'Es können nur Bibliotheken von libraries.excalidraw.com hinzugefügt werden.',
  libraryFailed: 'Die Bibliothek konnte nicht hinzugefügt werden.',
  imageTypeNotSupported: (name: string) =>
    `${name} wurde nicht hinzugefügt: Nur PNG-, JPEG-, GIF-, WebP- und SVG-Bilder sind möglich.`,
  imageTooLarge: (name: string) =>
    `${name} wurde nicht hinzugefügt: Die Datei ist größer als 4 MB.`,
  imageUnreadable: (name: string) =>
    `${name} wurde nicht hinzugefügt: Die Datei ist kein lesbares Bild.`,
  // Comments (#733)
  toolComments: 'Kommentare',
  toolCommentsTitle: 'Kommentare: Klicke auf ein Element oder eine Stelle, um zu kommentieren',
  commentsPanel: 'Kommentare',
  commentsClose: 'Kommentare schließen',
  commentsEmpty: 'Noch keine Kommentare.',
  commentsPlaceHint:
    'Klicke auf ein Element oder eine Stelle des Boards, um sie zu kommentieren. Esc beendet.',
  commentsNew: 'Neuer Kommentar',
  commentsOpenHeading: (count: number) => `Offen (${count})`,
  commentsResolvedHeading: (count: number) => `Erledigt (${count})`,
  commentOnElement: 'An einem Element',
  commentOnPoint: 'An einer Stelle des Boards',
  commentElementGone: 'Das Element gibt es nicht mehr',
  commentPlaceholder: 'Kommentar schreiben… (mit @ jemanden erwähnen)',
  replyPlaceholder: 'Antworten…',
  commentSend: 'Kommentieren',
  replySend: 'Antworten',
  commentCancel: 'Abbrechen',
  commentResolve: 'Erledigen',
  commentReopen: 'Wieder öffnen',
  commentDelete: 'Löschen',
  commentDeleteLabel: (author: string) => `Den Kommentar von ${author} löschen`,
  commentShow: 'Auf dem Board zeigen',
  commentResolvedBy: (name: string) => `Erledigt von ${name}`,
  commentMarker: (count: number, resolved: boolean) =>
    `${count === 1 ? '1 Kommentar' : `${count} Kommentare`}${resolved ? ', erledigt' : ''}`,
  commentCharactersLeft: (left: number) => `Noch ${left} Zeichen`,
  commentMentions: 'Personen',
  commentTooLong: (max: number) => `Ein Kommentar darf bis zu ${max} Zeichen haben.`,
  commentTooMany: 'Auf diesem Board oder in diesem Thread gibt es zu viele Kommentare.',
  commentFailed: 'Der Kommentar konnte nicht gespeichert werden.',
  commentsAppendixTitle: 'Kommentare',
  commentsAppendixOpen: 'Offen',
  commentsAppendixResolved: 'Erledigt',
  commentsAppendixOnElement: (label: string) => `An ${label}`,
  commentsAppendixOnPoint: 'An einer Stelle des Boards',
  pdfTitle: (name: string) => `${name} auf das Board bringen`,
  pdfLoading: 'Das PDF wird gelesen …',
  pdfSelectAll: 'Alle Seiten',
  pdfSelectNone: 'Keine Seite',
  pdfSharpness: 'Schärfe',
  pdfWidthOption: (px: number) => `${px} px breit`,
  pdfPagesLabel: 'Seiten',
  pdfPageName: (page: number) => `Seite ${page}`,
  pdfImportButton: (count: number) =>
    count === 1 ? '1 Seite importieren' : `${count} Seiten importieren`,
  pdfCancel: 'Abbrechen',
  pdfProgress: (done: number, total: number) => `Seite ${done} von ${total}`,
  pdfTooManyPages: (count: number, max: number) =>
    `Das PDF hat ${count} Seiten; die ersten ${max} können importiert werden.`,
  pdfEncrypted: (name: string) => `${name} ist passwortgeschützt und kann nicht gelesen werden.`,
  pdfInvalid: (name: string) => `${name} konnte nicht als PDF gelesen werden.`,
  pdfTooLarge: (name: string) => `${name} ist größer als 10 MB.`,
  pdfPagesSkipped: (pages: string) =>
    `Die Seiten ${pages} sind zu groß für ein Bild und wurden ausgelassen.`,
  pdfImported: (count: number) =>
    count === 1 ? '1 Seite importiert.' : `${count} Seiten importiert.`,
  pdfNeedsImages: 'Dieses Board kann keine Bilder aufnehmen, also auch kein PDF.',
  boardFull: 'Dieses Board ist voll: 20.000 Elemente.',
  boardFullServer: 'Dieses Board ist voll. Lösche etwas, um Platz zu schaffen.',
  updateTooLarge: 'Diese Änderung ist zu groß zum Senden.',
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
