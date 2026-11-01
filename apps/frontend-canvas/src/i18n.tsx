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
  // Following and presenting (#848)
  followingPill: (name: string) => `Following ${name} — Esc to stop`,
  presenterPill: (name: string) => `${name} is presenting`,
  presenterPillMe: 'You are presenting — everybody follows you',
  followPresenter: 'Follow presenter',
  errorNotOnBoardPerson: 'That person is not on the board, or has not shown their view yet.',
  errorPresenterBusy: 'Somebody else is presenting. Only they or an owner can end it.',
  errorNotPresenter: 'Only the presenter or an owner can end the presentation.',
  // History of the board (#846)
  menuHistory: 'History',
  historyPanel: 'History',
  historyClose: 'Close the history',
  historySave: 'Save version',
  historyNameLabel: 'Version name (optional)',
  historyNamePlaceholder: 'For example: before the workshop',
  historySaveConfirm: 'Save',
  historyCancel: 'Cancel',
  historyEmpty: 'No versions yet. Save one, or the board keeps them as you work.',
  historyLoading: 'Loading the history…',
  historyLoadFailed: 'The history could not be loaded.',
  historySaveFailed: 'The version could not be saved.',
  historyRenameFailed: 'The version could not be renamed.',
  historyDeleteFailed: 'The version could not be deleted.',
  historyForbidden: 'Your role on this board does not allow that.',
  historyConflict:
    'That is not possible now: the board has nothing saved yet, or it keeps 100 saved versions already.',
  historyUnavailable: 'The store for versions is not available right now.',
  historyKindManual: 'Saved version',
  historyKindAuto: 'Automatic version',
  historyKindBeforeRestore: 'Before restore',
  historyToday: 'Today',
  historyYesterday: 'Yesterday',
  historyBy: (author: string) => `by ${author}`,
  historyElements: (count: number) => (count === 1 ? '1 element' : `${count} elements`),
  historyPreviewOf: (title: string) => `Preview of ${title}`,
  historyNoPreview: 'No preview',
  historyRename: 'Rename',
  historyRenameOf: (title: string) => `Rename ${title}`,
  historyRenameSave: 'Rename',
  historyDelete: 'Delete',
  historyDeleteOf: (title: string) => `Delete ${title}`,
  historyDeleteQuestion: 'Delete this version? This cannot be undone.',
  historyDeleteConfirm: 'Delete version',
  historyRestore: 'Restore',
  historyRestoreOf: (title: string) => `Restore ${title}`,
  historyRestoreQuestion:
    'Restore this version? The board goes back to it for everybody. The current state is kept as "Before restore".',
  historyRestoreConfirm: 'Restore version',
  historyRestoreFailed: 'The version could not be restored.',
  historyRestored: 'The version is restored. The previous state is kept as "Before restore".',
  historyOpenAsNew: 'Open as new board',
  historyOpenAsNewOf: (title: string) => `Open ${title} as new board`,
  historyOpenAsNewFailed: 'The version could not be opened as a new board.',
  // The agenda of a workshop (#849)
  menuFacilitation: 'Facilitation',
  menuAgenda: 'Agenda',
  agendaPanel: 'Agenda',
  agendaClose: 'Close the agenda',
  agendaItems: 'Agenda items',
  agendaEmpty: 'No items yet. Add the steps of the workshop with their planned time.',
  agendaEmptyReadOnly: 'This board has no agenda.',
  agendaNewLabel: 'New item',
  agendaNewPlaceholder: 'For example: Introductions',
  agendaNewMinutes: 'Minutes',
  agendaAdd: 'Add',
  agendaTitleOf: (index: number) => `Title of item ${index}`,
  agendaMinutesOf: (title: string) => `Planned minutes for ${title}`,
  agendaStart: 'Start',
  agendaStartOf: (title: string) => `Start ${title}`,
  agendaNext: 'Next',
  agendaMoveUpOf: (title: string) => `Move ${title} up`,
  agendaMoveDownOf: (title: string) => `Move ${title} down`,
  agendaDeleteOf: (title: string) => `Delete ${title}`,
  agendaLinkFrame: 'Link to selected frame',
  agendaLinkFrameOf: (title: string) => `Link ${title} to the selected frame`,
  agendaLinkNeedsFrame: 'Select a frame on the board first.',
  agendaUnlinkOf: (title: string) => `Unlink the frame from ${title}`,
  agendaFrame: (name: string) => `Frame: ${name}`,
  agendaFrameGone: 'Frame: removed from the board',
  agendaUnnamedFrame: 'Frame',
  agendaPlanned: (minutes: number) => `${minutes} min planned`,
  agendaPlannedUnit: 'min planned',
  agendaSpent: (time: string) => `${time} spent`,
  agendaStateCurrent: 'Now',
  agendaStateDone: 'Done',
  agendaTotal: (minutes: number) => `Total: ${minutes} min`,
  agendaEnds: (time: string) => `Planned end: ${time}`,
  agendaNow: (title: string) => `Now: ${title}`,
  agendaTimeUp: (title: string) => `Time is up for ${title}. Press Next when you are ready.`,
  agendaThrough: 'The agenda is through.',
  agendaReorderHint: 'Drag an item, or press Alt+Arrow Up or Alt+Arrow Down on it, to reorder.',
  agendaPdfTitle: 'Agenda',
  agendaPdfTimes: (planned: number, spent: number) => `Planned ${planned} min, spent ${spent} min`,
  agendaPdfTotal: (planned: number, spent: number) =>
    `Total: planned ${planned} min, spent ${spent} min`,
  restoredNotice: (by: string, time: string) => `${by} restored the version of ${time}`,
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
  commentMentionsFound: (count: number) =>
    count === 1 ? '1 person found' : `${count} people found`,
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
  offlineDiscarded:
    'The board was rebuilt while you were offline, so the changes saved on this device could not be added.',
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
  // Folgen und Präsentieren (#848)
  followingPill: (name: string) => `Du folgst ${name} — Esc zum Beenden`,
  presenterPill: (name: string) => `${name} präsentiert`,
  presenterPillMe: 'Du präsentierst — alle folgen dir',
  followPresenter: 'Präsentation folgen',
  errorNotOnBoardPerson:
    'Diese Person ist nicht auf dem Board oder hat ihre Ansicht noch nicht gezeigt.',
  errorPresenterBusy: 'Jemand anderes präsentiert. Nur diese Person oder ein Owner kann beenden.',
  errorNotPresenter: 'Nur die präsentierende Person oder ein Owner kann die Präsentation beenden.',
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
  // Verlauf des Boards (#846)
  menuHistory: 'Verlauf',
  historyPanel: 'Verlauf',
  historyClose: 'Verlauf schließen',
  historySave: 'Version speichern',
  historyNameLabel: 'Name der Version (optional)',
  historyNamePlaceholder: 'Zum Beispiel: vor dem Workshop',
  historySaveConfirm: 'Speichern',
  historyCancel: 'Abbrechen',
  historyEmpty:
    'Noch keine Versionen. Speichere eine, oder das Board legt beim Arbeiten selbst welche an.',
  historyLoading: 'Der Verlauf wird geladen…',
  historyLoadFailed: 'Der Verlauf konnte nicht geladen werden.',
  historySaveFailed: 'Die Version konnte nicht gespeichert werden.',
  historyRenameFailed: 'Die Version konnte nicht umbenannt werden.',
  historyDeleteFailed: 'Die Version konnte nicht gelöscht werden.',
  historyForbidden: 'Deine Rolle auf diesem Board erlaubt das nicht.',
  historyConflict:
    'Das geht jetzt nicht: Das Board hat noch nichts gespeichert, oder es hat schon 100 gespeicherte Versionen.',
  historyUnavailable: 'Der Speicher für Versionen ist gerade nicht verfügbar.',
  historyKindManual: 'Gespeicherte Version',
  historyKindAuto: 'Automatische Version',
  historyKindBeforeRestore: 'Vor der Wiederherstellung',
  historyToday: 'Heute',
  historyYesterday: 'Gestern',
  historyBy: (author: string) => `von ${author}`,
  historyElements: (count: number) => (count === 1 ? '1 Element' : `${count} Elemente`),
  historyPreviewOf: (title: string) => `Vorschau von ${title}`,
  historyNoPreview: 'Keine Vorschau',
  historyRename: 'Umbenennen',
  historyRenameOf: (title: string) => `${title} umbenennen`,
  historyRenameSave: 'Umbenennen',
  historyDelete: 'Löschen',
  historyDeleteOf: (title: string) => `${title} löschen`,
  historyDeleteQuestion: 'Diese Version löschen? Das lässt sich nicht rückgängig machen.',
  historyDeleteConfirm: 'Version löschen',
  historyRestore: 'Wiederherstellen',
  historyRestoreOf: (title: string) => `${title} wiederherstellen`,
  historyRestoreQuestion:
    'Diese Version wiederherstellen? Das Board geht für alle auf sie zurück. Der aktuelle Stand bleibt als „Vor der Wiederherstellung“ erhalten.',
  historyRestoreConfirm: 'Version wiederherstellen',
  historyRestoreFailed: 'Die Version konnte nicht wiederhergestellt werden.',
  historyRestored:
    'Die Version ist wiederhergestellt. Der vorherige Stand bleibt als „Vor der Wiederherstellung“ erhalten.',
  historyOpenAsNew: 'Als neues Board öffnen',
  historyOpenAsNewOf: (title: string) => `${title} als neues Board öffnen`,
  historyOpenAsNewFailed: 'Die Version konnte nicht als neues Board geöffnet werden.',
  menuFacilitation: 'Moderation',
  menuAgenda: 'Agenda',
  agendaPanel: 'Agenda',
  agendaClose: 'Agenda schließen',
  agendaItems: 'Punkte der Agenda',
  agendaEmpty: 'Noch keine Punkte. Füge die Schritte des Workshops mit ihrer geplanten Zeit hinzu.',
  agendaEmptyReadOnly: 'Dieses Board hat keine Agenda.',
  agendaNewLabel: 'Neuer Punkt',
  agendaNewPlaceholder: 'Zum Beispiel: Vorstellungsrunde',
  agendaNewMinutes: 'Minuten',
  agendaAdd: 'Hinzufügen',
  agendaTitleOf: (index: number) => `Titel von Punkt ${index}`,
  agendaMinutesOf: (title: string) => `Geplante Minuten für ${title}`,
  agendaStart: 'Starten',
  agendaStartOf: (title: string) => `${title} starten`,
  agendaNext: 'Weiter',
  agendaMoveUpOf: (title: string) => `${title} nach oben`,
  agendaMoveDownOf: (title: string) => `${title} nach unten`,
  agendaDeleteOf: (title: string) => `${title} löschen`,
  agendaLinkFrame: 'Mit ausgewähltem Rahmen verknüpfen',
  agendaLinkFrameOf: (title: string) => `${title} mit dem ausgewählten Rahmen verknüpfen`,
  agendaLinkNeedsFrame: 'Wähle zuerst einen Rahmen auf dem Board aus.',
  agendaUnlinkOf: (title: string) => `Rahmen von ${title} lösen`,
  agendaFrame: (name: string) => `Rahmen: ${name}`,
  agendaFrameGone: 'Rahmen: vom Board entfernt',
  agendaUnnamedFrame: 'Rahmen',
  agendaPlanned: (minutes: number) => `${minutes} Min. geplant`,
  agendaPlannedUnit: 'Min. geplant',
  agendaSpent: (time: string) => `${time} gebraucht`,
  agendaStateCurrent: 'Jetzt',
  agendaStateDone: 'Erledigt',
  agendaTotal: (minutes: number) => `Gesamt: ${minutes} Min.`,
  agendaEnds: (time: string) => `Geplantes Ende: ${time}`,
  agendaNow: (title: string) => `Jetzt: ${title}`,
  agendaTimeUp: (title: string) =>
    `Die Zeit für ${title} ist um. Drücke Weiter, wenn ihr so weit seid.`,
  agendaThrough: 'Die Agenda ist durch.',
  agendaReorderHint:
    'Ziehe einen Punkt oder drücke darauf Alt+Pfeil nach oben oder Alt+Pfeil nach unten, um die Reihenfolge zu ändern.',
  agendaPdfTitle: 'Agenda',
  agendaPdfTimes: (planned: number, spent: number) =>
    `Geplant ${planned} Min., gebraucht ${spent} Min.`,
  agendaPdfTotal: (planned: number, spent: number) =>
    `Gesamt: geplant ${planned} Min., gebraucht ${spent} Min.`,
  restoredNotice: (by: string, time: string) =>
    `${by} hat die Version vom ${time} wiederhergestellt`,
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
  commentMentionsFound: (count: number) =>
    count === 1 ? '1 Person gefunden' : `${count} Personen gefunden`,
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
  offlineDiscarded:
    'Das Board wurde neu aufgebaut, während du offline warst. Die auf diesem Gerät gesicherten Änderungen konnten nicht hinzugefügt werden.',
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
