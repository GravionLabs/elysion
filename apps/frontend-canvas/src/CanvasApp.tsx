import { Suspense, lazy, useCallback, useEffect, useRef, useState } from 'react';
import {
  exportBoard,
  exportThumbnail,
  clearScene,
  importFile,
  insertFile,
  type ExportFormat,
  type ExportOptions,
} from './board-io';
import type { CanvasMenuItem } from './CanvasMenu';
import {
  DEFAULT_GRID,
  GRID_SIZES,
  observeGrid,
  readGrid,
  writeGrid,
  type GridSettings,
  type GridSize,
} from './board-settings';
import { forgetLegacyGridSettings, readStickyColor, writeStickyColor } from './canvas-settings';
import { ConnectionPoints } from './ConnectionPoints';
import { VoteBadges } from './facilitation/VoteBadges';
import { commitConnector } from './connector-commit';
import {
  connectableSelection,
  connectorDirection,
  createConnector,
  findConnector,
} from './connector';
import { NO_SELECTION, trackSelection, type SelectionOrder } from './selection-order';
import { Minimap } from './Minimap';
import { insertImages, isImageFile } from './image-insert';
import { isPdf } from './pdf-import/pdf-pages';
import { SceneStore } from './scene-store';
import { scrollToCenter } from './minimap-geometry';
import { ZOOM_STEP, zoomAbout } from './zoom';
import { isAllowedLibraryUrl, libraryAdapter, parseAddLibrary } from './library-store';
import { I18nProvider, excalidrawLangCode, createI18n, type Locale } from './i18n';
import { Toolbar, type HistoryAction, type ToolbarTool, type ZoomAction } from './Toolbar';
import { ELEMENT_DEFAULTS } from './element-style';
import { applyGridDots } from './grid-dots';
import { createStickyNote, type StickyColor } from './sticky-note';
import { useResolvedTheme, type CanvasTheme } from './useResolvedTheme';
import {
  CaptureUpdateAction,
  DefaultSidebar,
  Excalidraw,
  viewportCoordsToSceneCoords,
} from '@excalidraw/excalidraw';
import '@excalidraw/excalidraw/index.css';
import '@elysion/design-tokens/tokens.css';
import './styles/excalidraw-theme.css';
import './styles/grid.css';
import './styles/toolbar.css';
import './styles/connection-points.css';
import './styles/voting.css';
import './styles/follow.css';
import './styles/comments.css';
import './styles/history.css';
import './styles/pdf-import.css';
import type { ExcalidrawImperativeAPI, ToolType } from '@excalidraw/excalidraw/types';
import * as Y from 'yjs';
import { ExcalidrawYjsBinding } from './yjs/excalidraw-binding.js';
import type { FileStore } from './yjs/files.js';
import { YjsWebsocketClient, type YjsConnectionStatus } from './yjs/YjsWebsocketClient.js';
import { OfflineWork, type OfflineState } from './yjs/offline-work.js';
import { createSessionIdentity, withHostIdentity } from './presence/identity';
import type { PresentUser } from './presence/collaborators';
import type { Awareness } from 'y-protocols/awareness';
import type { VotableElement } from './facilitation/voting';
import { PresenceSync } from './presence/presence';
import { FollowController, NOT_FOLLOWING, type FollowState } from './presence/follow';
import { FollowOverlay } from './presence/FollowOverlay';
import { viewportOf } from './presence/viewport';
import {
  readPresenter,
  startPresenting,
  stopPresenting,
  summonEveryone,
} from './facilitation/presenter';
import {
  type TimerState,
  extendTimer,
  pauseTimer,
  resumeTimer,
  startTimer,
  stopTimer,
} from './facilitation/timer';
import { type TimerSync, observeTimer } from './facilitation/timer-sync';
import { type AllVotedWatch, publishVoter, watchAllVoted } from './facilitation/voting-auto-end';
import { VotingController } from './facilitation/voting-controller';
import { dropLegacyVoting } from './facilitation/voting-legacy';
import {
  type StartOptions,
  type VotingApi,
  type VotingSnapshot,
  type VotingView,
  NO_VOTING,
} from './facilitation/voting';
import { elementLabel } from './facilitation/voting';
import {
  type CommentAnchor,
  type CommentThread,
  addReply,
  addThread,
  countThreads,
  deleteMessage,
  ensureComments,
  knownNames,
  type MentionNames,
  observeComments,
  readThreads,
  setResolved,
} from './comments/comments';
import { CommentLayer } from './comments/CommentLayer';
import { CommentPanel } from './comments/CommentPanel';
import { HistoryPanel } from './history/HistoryPanel';
import type { OpenedBoard, SnapshotApi } from './history/history';
import { buildAppendix } from './comments/appendix';
import type { Person } from './comments/mentions';

/**
 * Whether a key goes into text rather than to the canvas: typed into a field (the panels' own inputs too), into
 * Excalidraw's text editor, or part of an IME composition. The canvas's keyboard shortcuts leave such a key alone.
 */
const isTextEntry = (event: KeyboardEvent, api: ExcalidrawImperativeAPI | null): boolean =>
  event.isComposing ||
  (event.target instanceof Element &&
    event.target.closest('input, textarea, select, [contenteditable="true"]') !== null) ||
  Boolean(api?.getAppState().editingTextElement);

/** What the host can ask the canvas to do; the element exposes these as methods. */
export interface CanvasControls {
  /** The board as the picture of its card (#729): a 480 by 300 PNG in the light theme, or `null` when the board is empty. */
  exportThumbnail(): Promise<Blob | null>;
  /** Opens Excalidraw's library sidebar, or closes it when it is open. */
  toggleLibrary(): void;
  /**
   * Resolves when the images the board shows have been loaded (nothing is being fetched or uploaded any more), or after at
   * most `timeoutMs`. For an export of a board nobody is looking at (#727): the pictures must be there before it is made.
   */
  whenSettled(timeoutMs?: number): Promise<void>;
  /** The board (or the selection) as a file, or `null` when there is nothing to export. */
  exportBoard(format: ExportFormat, options?: ExportOptions): Promise<Blob | null>;
  /** Replaces the board with the contents of an .excalidraw file; resolves with its element count. */
  importFile(file: Blob): Promise<number>;
  /** Opens the PDF import (#725): a dialog with the pages, then a picture in a frame per chosen page; resolves with the number of pages put on the board (0 when canceled). */
  importPdf(file: Blob): Promise<number>;
  /** Adds the contents of an .excalidraw file next to what is on the board, around the view center; resolves with the count added. */
  insertFile(file: Blob): Promise<number>;
  /**
   * The shared timer (ADR 0020), for everybody on the board; each rejects on a read-only canvas and before the canvas is
   * up. The canvas keeps the state and announces it (`onTimerChange`), it does not draw the timer.
   */
  startTimer(durationMs: number): Promise<void>;
  pauseTimer(): Promise<void>;
  resumeTimer(): Promise<void>;
  extendTimer(ms: number): Promise<void>;
  stopTimer(): Promise<void>;
  /**
   * Dot voting (ADR 0029), kept by the business backend and reached through the host's `votingApi`: starting, ending and
   * clearing reject on a read-only canvas (only editors do those), and everything rejects before the canvas is up or
   * without a `votingApi`. `startVoting` rejects while a voting is open (the server says so). Viewers vote on the canvas
   * like anybody else. The canvas keeps the state and announces it (`onVotingChange`).
   */
  startVoting(options: StartOptions): Promise<void>;
  /** Closes the open voting: nobody can vote any more and the result is shown. A no-op when none is open. */
  endVoting(): Promise<void>;
  /** Removes the results: every closed voting, with its votes. An open voting stays. A no-op when there are none. */
  clearVotingResults(): Promise<void>;
  /** Scrolls the view to an element (a result of the voting); rejects when it is not on the board. */
  scrollToElement(elementId: string): Promise<void>;
  /**
   * Follows a person (#848): this canvas shows what their window shows (fitted into its own window, through the tab of them
   * whose view changed last) until the person pans, zooms or presses Esc. Rejects when they are not on the board or have
   * not shown a view yet, and before the canvas is up. Works on a read-only canvas.
   */
  follow(userId: string): Promise<void>;
  /** Ends following a person or the presenter (what Esc does). */
  stopFollowing(): Promise<void>;
  /** Goes back into the presentation this person stepped out of. */
  followPresenter(): Promise<void>;
  /**
   * Makes this person the presenter: everybody on the board follows them while they are on it. Editors and owners; rejects
   * on a read-only canvas, and while somebody else presents (unless the host says `can-moderate`).
   */
  startPresenting(): Promise<void>;
  /** Ends the presentation: for the presenter and an owner (`can-moderate`); a no-op when nobody presents. */
  stopPresenting(): Promise<void>;
  /** "Bring everyone to me": everybody else's view jumps once to this one, without following. Editors and owners. */
  summonEveryone(): Promise<void>;
}

export interface CanvasAppProps {
  boardId?: string;
  /**
   * Yjs sync gateway base URL (see apps/realtime's YjsGateway); the board
   * id is appended as a `?board=` query param. Defaults to a same-origin
   * `/yjs` path — production routing through Traefik isn't settled yet
   * (Feature #28), so override this once it is.
   */
  yjsServerUrl?: string;
  /** `light` or `dark`; follows the system preference while unset. */
  theme?: CanvasTheme;
  /** The language of the canvas' own texts and of Excalidraw's; English while unset. */
  locale?: Locale;
  /** The Yjs connection changed; also called once with `connecting` when the canvas starts. */
  onStatusChange?: (status: YjsConnectionStatus) => void;
  /**
   * An outage began or ended, or the changes made during it grew (#735): whether the connection is down after the board was
   * loaded, since when, how many changes this device holds that the board does not, and, once it is back, how many were sent.
   */
  onOfflineChange?: (state: OfflineState) => void;
  /**
   * The user switched the theme inside the canvas (Excalidraw's own toggle). Not called when the host
   * sets `theme` or the system preference changes: the host already knows about those.
   */
  onThemeChange?: (theme: CanvasTheme) => void;
  /** Called once when the canvas is ready to be controlled. */
  onControls?: (controls: CanvasControls) => void;
  /** The library sidebar opened or closed, by the host or by the user. */
  onLibraryChange?: (open: boolean) => void;
  /** The number of selected elements changed. */
  onSelectionCount?: (count: number) => void;
  /** The other people on the board changed (somebody joined, left or was renamed); settled, not per pointer move. */
  onPresenceChange?: (users: PresentUser[]) => void;
  /**
   * Whom this client follows, who presents and whether this client stepped out of the presentation changed (#848). Also
   * called after the connection was made, so the host learns the state of a board it joined while somebody presents.
   */
  onFollowChange?: (state: FollowState) => void;
  /**
   * The shared timer changed, on this client or another: its state, or `null` when there is none. Also called after
   * the connection was made, so somebody who joins while a timer runs gets it.
   */
  onTimerChange?: (state: TimerState | null) => void;
  /**
   * The voting changed, on this client or another: the current voting as this person sees it (their own votes, the
   * result once it is closed), or `null`. Also called after the connection was made, so a late joiner gets it.
   */
  onVotingChange?: (view: VotingView | null) => void;
  /** The comments changed (#733): how many threads the board has and how many of them are still open. */
  onCommentsChange?: (summary: { total: number; unresolved: number }) => void;
  /** The connection to the board server failed; the canvas keeps retrying, so this is news, not the end. */
  onError?: (error: Error) => void;
  /** Something the person should be told that is not a failure of the board: the board is full, a change was too large, a library was refused. */
  onNotice?: (message: string) => void;
  /** "Open as new board" in the History panel made a board (#847): the host navigates to it. */
  onOpenBoard?: (board: OpenedBoard) => void;
  /**
   * Asked before every connection to the board server (the first and each reconnect) for the token that goes on the
   * URL; see `YjsWebsocketClientOptions.tokenProvider` for what it may return. Without one, no token is sent.
   */
  tokenProvider?: () => Promise<string | null | undefined>;
  /**
   * Where the bytes of the board's images are stored (#702): an image is uploaded here when it is inserted, the shared
   * document gets a reference to it, and the other clients load it from here. Without one the images stay on this screen.
   */
  fileStore?: FileStore;
  /**
   * How the canvas reaches the board's voting on the server (ADR 0029): the host sets it together with a board that has a
   * record. Without one the voting does nothing and `startVoting` rejects.
   */
  votingApi?: VotingApi;
  /**
   * How the canvas reaches the board's versions (#846, ADR 0032): the host sets it together with a board that has a record.
   * Without one the History panel stays unavailable.
   */
  snapshotApi?: SnapshotApi;
  /**
   * The people `@` offers in a comment (#733): `{id, name}` with the identity provider's id, which is what a mention stores.
   * Asked each time the comments open. Without one only the authors of earlier comments are offered.
   */
  mentionDirectory?: () => Promise<readonly Person[]>;
  /**
   * The people matching what is typed after `@` (at least two characters, asked after a short rest): `{id, name}` as in
   * {@link mentionDirectory}. The host's own people search (the one of its Share dialog). Optional; without it only the
   * directory is offered. A failure leaves the directory's list as it is.
   */
  mentionSearch?: (query: string) => Promise<readonly Person[]>;
  /** The board's owner: may delete any comment. Everybody else deletes their own (a rule of the interface, not of the server). */
  canModerate?: boolean;
  /** An image could not be stored (the element is taken off the board again) or loaded; `message` says why. */
  onFileError?: (error: Error) => void;
  /** The server's state of the board has arrived (after every connect): what the scene shows is what the board holds. */
  onSynced?: () => void;
  /**
   * A viewer: Excalidraw's view mode, no drawing tools in the toolbar, no import and no "clear canvas". The
   * realtime service refuses a viewer's changes anyway; this is what the viewer sees instead of tools that would
   * silently do nothing.
   */
  readOnly?: boolean;
  /**
   * Whether images may be inserted (the toolbar's tool, its shortcut, paste and drop). Off by default: without a
   * `fileStore` an image would be seen by its author only and be gone after a reload. Excalidraw refuses an image
   * itself when this is off ("Images are disabled"). The host switches it on together with the `fileStore`.
   */
  imagesEnabled?: boolean;
  /** The most live elements the board holds (the `max-elements` attribute); 20,000 when not given (ADR 0026). */
  maxElements?: number;
  /** The name shown next to this user's cursor on other screens; a generated guest name when unset. */
  userName?: string;
  /** Who this user is (the identity provider's id): what the timer remembers about who started it. A per-tab id when unset. */
  userId?: string;
  /** The color of this user's cursor, `#rrggbb`; one picked from the palette when unset or not valid. */
  userColor?: string;
}

function defaultYjsServerUrl(): string {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}/yjs`;
}

// Excalidraw only offers its own light/dark toggle when it is not given a `theme`; we always pass one
// (the host or the system decides), so the toggle has to be switched on explicitly.
/** The PDF dialog and pdf.js with it are loaded when a PDF is chosen or dropped, not with the canvas (#725). */
const PdfImportDialog = lazy(() => import('./pdf-import/PdfImportDialog'));

const UI_OPTIONS = { canvasActions: { toggleTheme: true }, tools: { image: false } };
const UI_OPTIONS_WITH_IMAGES = { canvasActions: { toggleTheme: true }, tools: { image: true } };

const LIBRARY_ADAPTER = libraryAdapter();

// Excalidraw's own library: the default sidebar, on its library tab.
const LIBRARY_SIDEBAR = 'default';
const LIBRARY_TAB = 'library';

export function CanvasApp({
  boardId = 'default',
  yjsServerUrl,
  theme,
  locale = 'en',
  onStatusChange,
  onOfflineChange,
  onThemeChange,
  onControls,
  onLibraryChange,
  onSelectionCount,
  onPresenceChange,
  onFollowChange,
  onTimerChange,
  onVotingChange,
  onCommentsChange,
  onError,
  onNotice,
  onOpenBoard,
  tokenProvider,
  fileStore,
  votingApi,
  snapshotApi,
  mentionDirectory,
  mentionSearch,
  canModerate = false,
  onFileError,
  onSynced: onSyncedProp,
  readOnly = false,
  imagesEnabled = false,
  maxElements,
  userName,
  userId,
  userColor,
}: CanvasAppProps) {
  const { t } = createI18n(locale);
  // Read by the callbacks the canvas hands to the host once, which must speak the current language.
  const tRef = useRef(t);
  tRef.current = t;
  const resolvedTheme = useResolvedTheme(theme);
  // What is shown right now: a toggle inside Excalidraw changes it, and so does a new `theme`
  // attribute or system preference (which wins over an earlier toggle).
  const [activeTheme, setActiveTheme] = useState<CanvasTheme>(resolvedTheme);
  useEffect(() => setActiveTheme(resolvedTheme), [resolvedTheme]);
  // The binding draws the sticky notes in the colors of the theme (#737): it needs the theme at its start and at every switch.
  const activeThemeRef = useRef(activeTheme);
  activeThemeRef.current = activeTheme;
  // The theme Excalidraw last reported. It lags behind `activeTheme` for a moment after the host
  // changed the attribute, so a mismatch alone does not mean the user switched it: only a change of
  // Excalidraw's own value does.
  const lastReportedTheme = useRef<CanvasTheme>(resolvedTheme);
  // Callbacks are read through refs: the connection below is created once per mount.
  const offlineCallback = useRef(onOfflineChange);
  offlineCallback.current = onOfflineChange;
  const statusCallback = useRef(onStatusChange);
  const themeCallback = useRef(onThemeChange);
  statusCallback.current = onStatusChange;
  themeCallback.current = onThemeChange;
  const controlsCallback = useRef(onControls);
  const libraryCallback = useRef(onLibraryChange);
  controlsCallback.current = onControls;
  libraryCallback.current = onLibraryChange;
  const libraryOpen = useRef(false);
  const selectionCallback = useRef(onSelectionCount);
  selectionCallback.current = onSelectionCount;
  const selectionCount = useRef(0);
  const presenceCallback = useRef(onPresenceChange);
  const followCallback = useRef(onFollowChange);
  followCallback.current = onFollowChange;
  const canModerateRef = useRef(canModerate);
  canModerateRef.current = canModerate;
  const timerCallback = useRef(onTimerChange);
  timerCallback.current = onTimerChange;
  const votingCallback = useRef(onVotingChange);
  votingCallback.current = onVotingChange;
  const commentsCallback = useRef(onCommentsChange);
  commentsCallback.current = onCommentsChange;
  const mentionDirectoryRef = useRef(mentionDirectory);
  mentionDirectoryRef.current = mentionDirectory;
  const mentionSearchRef = useRef(mentionSearch);
  mentionSearchRef.current = mentionSearch;
  // One function for the life of the canvas, so that the composer's search does not start again on every render.
  const searchPeople = useCallback(
    (query: string) => Promise.resolve(mentionSearchRef.current?.(query) ?? []),
    [],
  );
  const errorCallback = useRef(onError);
  presenceCallback.current = onPresenceChange;
  errorCallback.current = onError;
  const noticeCallback = useRef(onNotice);
  noticeCallback.current = onNotice;
  const openBoardCallback = useRef(onOpenBoard);
  openBoardCallback.current = onOpenBoard;
  const localeRef = useRef(locale);
  localeRef.current = locale;
  const tokenProviderRef = useRef(tokenProvider);
  tokenProviderRef.current = tokenProvider;
  const fileStoreRef = useRef(fileStore);
  fileStoreRef.current = fileStore;
  const snapshotApiRef = useRef(snapshotApi);
  snapshotApiRef.current = snapshotApi;
  const votingApiRef = useRef(votingApi);
  votingApiRef.current = votingApi;
  const fileErrorCallback = useRef(onFileError);
  fileErrorCallback.current = onFileError;
  const syncedCallback = useRef(onSyncedProp);
  syncedCallback.current = onSyncedProp;
  const readOnlyRef = useRef(readOnly);
  readOnlyRef.current = readOnly;
  const apiRef = useRef<ExcalidrawImperativeAPI | null>(null);
  // The same API as a state: the library hook below has to run again when the canvas is there.
  const [excalidrawApi, setExcalidrawApi] = useState<ExcalidrawImperativeAPI | null>(null);
  // The user's library (library-store.ts): loaded when the canvas is there, and the library the user chose on the library site
  // ("Browse libraries" comes back with `#addLibrary=…`) is added to it.
  useEffect(() => {
    const api = excalidrawApi;
    if (!api) return;
    let gone = false;
    const takeUpAddress = async () => {
      const request = parseAddLibrary(window.location.hash);
      if (!request) return;
      // The address is cleaned first, so a reload does not add it again; its own path stays (`replaceState` with `#…` alone would
      // be resolved against the page's <base href>).
      const { pathname, search } = window.location;
      window.history.replaceState(window.history.state, '', `${pathname}${search}${request.rest}`);
      if (!isAllowedLibraryUrl(request.url)) {
        noticeCallback.current?.(tRef.current.libraryNotAllowed);
        return;
      }
      try {
        const response = await fetch(request.url);
        if (!response.ok) throw new Error(String(response.status));
        await api.updateLibrary({
          libraryItems: await response.blob(),
          // Asks, unless this is the page that sent the user away.
          prompt: request.token !== api.id,
          merge: true,
          defaultStatus: 'published',
          openLibraryMenu: true,
        });
      } catch {
        if (!gone) noticeCallback.current?.(tRef.current.libraryFailed);
      }
    };
    void (async () => {
      const stored = LIBRARY_ADAPTER.load();
      if (stored) await api.updateLibrary({ libraryItems: stored.libraryItems, merge: true });
      if (!gone) await takeUpAddress();
    })();
    const onHashChange = () => void takeUpAddress();
    window.addEventListener('hashchange', onHashChange);
    return () => {
      gone = true;
      window.removeEventListener('hashchange', onHashChange);
    };
  }, [excalidrawApi]);
  // Counts the times the document was replaced: the server rebuilt the board while this tab was away (ADR 0026), so the
  // tab throws its Y.Doc away and connects again with a new one (the effect below runs again), and the scene is kept.
  const [epoch, setEpoch] = useState(0);
  const maxElementsRef = useRef(maxElements);
  maxElementsRef.current = maxElements;
  const bindingRef = useRef<ExcalidrawYjsBinding | null>(null);
  const presenceRef = useRef<PresenceSync | null>(null);
  const followRef = useRef<FollowController | null>(null);
  // Whom this client follows, for the frame and the pill.
  const [follow, setFollow] = useState<FollowState>(NOT_FOLLOWING);
  const docRef = useRef<Y.Doc | null>(null);
  const timerSyncRef = useRef<TimerSync | null>(null);
  const votingControllerRef = useRef<VotingController | null>(null);
  const awarenessRef = useRef<Awareness | null>(null);
  const allVotedRef = useRef<AllVotedWatch | null>(null);
  // The voting as this person sees it: what the badges and the vote mode work from (see the voting section below).
  const [voting, setVoting] = useState<VotingSnapshot>(NO_VOTING);
  const votingRef = useRef(voting);
  votingRef.current = voting;
  const userIdRef = useRef(userId);
  userIdRef.current = userId;
  // Comments (#733): the threads of the document, whether the panel is open, whether the next click places a comment, where a
  // new comment is being written, and the thread a marker was clicked for.
  const [threads, setThreads] = useState<CommentThread[]>([]);
  const threadsRef = useRef(threads);
  threadsRef.current = threads;
  const [commentsOpen, setCommentsOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [placing, setPlacing] = useState(false);
  const [pendingAnchor, setPendingAnchor] = useState<CommentAnchor | null>(null);
  const [activeThread, setActiveThread] = useState<string | null>(null);
  const [directory, setDirectory] = useState<readonly Person[]>([]);
  // Who this tab is, made once: a re-render must not make a new collaborator.
  const identityRef = useRef(createSessionIdentity());
  const identity = withHostIdentity(identityRef.current, userName, userColor, userId);
  const identityNow = useRef(identity);
  identityNow.current = identity;
  const sceneStoreRef = useRef(new SceneStore());
  const [activeTool, setActiveTool] = useState<ToolType | 'custom'>('selection');
  const [zoomPercent, setZoomPercent] = useState(100);
  // Exactly two connectable elements are selected: the Connect button is shown, and C connects them.
  const [canConnect, setCanConnect] = useState(false);
  // The grid is a setting of the board (board-settings.ts, #754): everybody sees the same one. `show` draws the dots in the
  // background (grid-dots.ts), `snap` is Excalidraw's grid mode. The defaults hold until the document has synced.
  const [grid, setGrid] = useState<GridSettings>(DEFAULT_GRID);
  // The color of the next sticky note: the one used last, kept per browser (yellow at first).
  const [stickyColor, setStickyColor] = useState<StickyColor>(readStickyColor);
  const stickyColorRef = useRef(stickyColor);
  stickyColorRef.current = stickyColor;
  const gridRef = useRef(grid);
  gridRef.current = grid;
  const changeGridRef = useRef<(change: Partial<GridSettings>) => void>(() => undefined);
  const selectionOrder = useRef<SelectionOrder>(NO_SELECTION);
  const rootRef = useRef<HTMLDivElement>(null);
  const imagesEnabledRef = useRef(imagesEnabled);
  imagesEnabledRef.current = imagesEnabled;

  // The PDF that is being imported (#725): the dialog is shown while there is one, and the promise of `importPdf` is settled by it.
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const pdfSettle = useRef<((inserted: number) => void) | null>(null);
  const finishPdf = (inserted: number, notice?: string) => {
    setPdfFile(null);
    pdfSettle.current?.(inserted);
    pdfSettle.current = null;
    if (notice) noticeCallback.current?.(notice);
  };
  const startPdf = (file: Blob): Promise<number> => {
    if (readOnlyRef.current) return Promise.reject(new Error(tRef.current.errorReadOnly));
    if (!imagesEnabledRef.current) return Promise.reject(new Error(tRef.current.pdfNeedsImages));
    if (pdfSettle.current) return Promise.reject(new Error(tRef.current.errorBusy));
    return new Promise<number>((resolve) => {
      pdfSettle.current = resolve;
      setPdfFile(
        file instanceof File ? file : new File([file], 'document.pdf', { type: 'application/pdf' }),
      );
    });
  };
  const startPdfRef = useRef(startPdf);
  startPdfRef.current = startPdf;

  /**
   * Image files dropped on the canvas or pasted into it (#724): several become a row, an SVG a PNG, and what cannot be
   * added is said. Taken before Excalidraw sees the event (capture phase) so that it does not insert the first one a second
   * time. With images off Excalidraw answers itself ("Images are disabled"); a viewer's drop is swallowed.
   */
  const takeImages = (
    event: Event,
    files: FileList | null | undefined,
    at?: { x: number; y: number },
  ) => {
    const pdf = [...(files ?? [])].find(isPdf);
    if (pdf && imagesEnabledRef.current && apiRef.current && !pdfSettle.current) {
      event.preventDefault();
      event.stopImmediatePropagation();
      if (!readOnlyRef.current) void startPdfRef.current(pdf);
      return;
    }
    const images = [...(files ?? [])].filter(isImageFile);
    const api = apiRef.current;
    if (images.length === 0 || !api || !imagesEnabledRef.current) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (readOnlyRef.current) return;
    void insertImages(
      {
        api,
        notify: (message) => noticeCallback.current?.(message),
        messages: tRef.current,
      },
      images,
      at,
    );
  };
  const takeImagesRef = useRef(takeImages);
  takeImagesRef.current = takeImages;
  const onDropCapture = (event: React.DragEvent) => {
    const api = apiRef.current;
    const point =
      api &&
      viewportCoordsToSceneCoords(
        { clientX: event.clientX, clientY: event.clientY },
        api.getAppState(),
      );
    takeImages(event.nativeEvent, event.dataTransfer.files, point ?? undefined);
  };
  // A paste goes to the focused element, which is the page's body while the canvas has the focus, so the listener is on the
  // document, in the capture phase: before Excalidraw's own (a bubbling one on the document).
  useEffect(() => {
    const onPaste = (event: ClipboardEvent) => {
      const target = event.target as HTMLElement | null;
      // A paste into a text being edited, or into a field of the page, is that field's own business.
      if (target?.closest('textarea, input, [contenteditable="true"]')) return;
      if (target !== document.body && !rootRef.current?.contains(target)) return;
      takeImagesRef.current(event, event.clipboardData?.files);
    };
    document.addEventListener('paste', onPaste, true);
    return () => document.removeEventListener('paste', onPaste, true);
  }, []);

  // Connection setup lives in the effect, not render, and is re-created (not
  // just torn down) on cleanup: React StrictMode's dev-only
  // mount→cleanup→mount for effects means a render-time "create once" ref
  // guard would leave bindingRef null forever after the simulated
  // cleanup — nothing re-populates it since no second render follows.
  // boardId/yjsServerUrl deliberately aren't dependencies: connect once per
  // mount, matching how this component previously treated boardId for
  // tldraw's persistenceKey.
  useEffect(() => {
    const doc = new Y.Doc();
    docRef.current = doc;
    forgetLegacyGridSettings(); // what a browser kept of the grid before it was the board's
    setGrid(readGrid(doc));
    const stopGrid = observeGrid(doc, setGrid);
    const timerSync = observeTimer(doc, (state) => timerCallback.current?.(state));
    timerSyncRef.current = timerSync;
    setThreads(readThreads(doc));
    const commentsSync = observeComments(doc, (next) => {
      setThreads(next);
      commentsCallback.current?.(countThreads(next));
    });
    // The voting lives on the server (ADR 0029): this follows it for the person, through the host's `votingApi`.
    const votingSync = new VotingController({
      api: () => votingApiRef.current,
      elements: () => (apiRef.current?.getSceneElements() ?? []) as readonly VotableElement[],
      onChange: (snapshot) => {
        setVoting(snapshot);
        votingCallback.current?.(snapshot.view);
      },
      messages: () => ({ notReady: tRef.current.errorNotReady }),
    });
    votingControllerRef.current = votingSync;
    const sceneUnsubscribe = sceneStoreRef.current.subscribe(() => votingSync.check());
    const binding = new ExcalidrawYjsBinding(doc, {
      fileStore: () => fileStoreRef.current,
      onError: (error) => fileErrorCallback.current?.(error),
      maxElements: () => maxElementsRef.current,
      onLimit: () => noticeCallback.current?.(tRef.current.boardFull),
    });
    bindingRef.current = binding;
    binding.setTheme(activeThemeRef.current);
    if (apiRef.current) {
      binding.attach(apiRef.current);
    }

    const url = new URL(yjsServerUrl ?? defaultYjsServerUrl());
    url.searchParams.set('board', boardId);
    // After a replacement the scene still holds the board as this tab knew it: once the server's state is in, write what
    // the scene has that the board lacks (the usual per-element rule decides, so nobody's newer change is overwritten).
    const replaced = epoch > 0;
    let pushed = false;
    // The document is kept on the device during an outage (#735); the client is read when it is needed.
    const connection: { client?: YjsWebsocketClient } = {};
    const offlineWork = new OfflineWork({
      doc,
      boardId,
      serverOrigin: () => connection.client,
      canWrite: () => !readOnlyRef.current,
      onChange: (state) => offlineCallback.current?.(state),
      onDiscarded: () => noticeCallback.current?.(tRef.current.offlineDiscarded),
    });
    const client = new YjsWebsocketClient(url.toString(), doc, {
      onSynced: () => {
        void offlineWork.synced(connection.client?.generation ?? '');
        syncedCallback.current?.();
        followRef.current?.synced();
        // The voting is the server's: ask for it (a late joiner, a reconnect). The old document key goes.
        void votingSync.refresh();
        // The map of the comments is made by those who may write, as soon as they are connected: a viewer's first comment
        // may then only add a thread to it (the realtime service refuses a viewer's creation of the map when two race).
        if (!readOnlyRef.current) ensureComments(doc);
        setThreads(readThreads(doc));
        commentsCallback.current?.(countThreads(readThreads(doc)));
        if (!readOnlyRef.current) {
          const open = dropLegacyVoting(doc);
          if (open) noticeCallback.current?.(tRef.current.legacyVotingClosed(open.name, open.top));
        }
        if (replaced && !pushed) {
          pushed = true;
          binding.pushScene();
        }
      },
      onVoting: (payload) => votingSync.handleBroadcast(payload),
      onStaleCopy: () => {
        void offlineWork.stale();
        setEpoch((value) => value + 1);
      },
      onBoardFull: () => noticeCallback.current?.(tRef.current.boardFullServer),
      onRestored: (payload) => {
        const { by, at } = (payload ?? {}) as { by?: unknown; at?: unknown };
        if (typeof by !== 'string' || typeof at !== 'string' || Number.isNaN(Date.parse(at)))
          return;
        const time = new Date(at).toLocaleString(localeRef.current, {
          dateStyle: 'medium',
          timeStyle: 'short',
        });
        noticeCallback.current?.(tRef.current.restoredNotice(by, time));
      },
      onUpdateTooLarge: () => noticeCallback.current?.(tRef.current.updateTooLarge),
      onStatusChange: (status) => {
        statusCallback.current?.(status);
        if (status === 'disconnected') offlineWork.disconnected();
        if (status === 'connected') {
          followRef.current?.refresh();
          followCallback.current?.(followRef.current?.state ?? NOT_FOLLOWING);
        }
        // The shell learns what the board's timer is once the connection is up, also when there is none.
        if (status === 'connected') {
          timerSync.emit();
          votingSync.emit();
        }
      },
      onError: (error) => errorCallback.current?.(error),
      // Read at every connect, so a provider the host sets later (after the element started) is used for the next
      // attempt; none set: no token (a gateway without authentication).
      tokenProvider: () => tokenProviderRef.current?.() ?? Promise.resolve(undefined),
    });

    connection.client = client;

    const presence = new PresenceSync(
      client.awareness,
      identityNow.current,
      () => apiRef.current,
      (users) => presenceCallback.current?.(users),
    );
    presenceRef.current = presence;

    // Following a person or the presenter, and the jump of "bring everyone to me" (#848).
    const followController = new FollowController({
      awareness: client.awareness,
      doc,
      api: () => apiRef.current,
      me: () => identityNow.current.id,
      canWrite: () => !readOnlyRef.current,
      onChange: (state) => {
        setFollow(state);
        followCallback.current?.(state);
      },
    });
    followRef.current = followController;

    // Who this client is for a voting, and the watch that ends it once everybody present has used all their votes.
    // After the presence sync, which sets the awareness state as a whole.
    awarenessRef.current = client.awareness;
    publishVoter(client.awareness, voterState());
    const allVotedWatch = watchAllVoted(
      client.awareness,
      () => {
        const open = votingSync.current;
        return open && open.status === 'open' ? open : null;
      },
      () => !readOnlyRef.current,
      () => void votingSync.end().catch(() => undefined),
    );
    allVotedRef.current = allVotedWatch;

    return () => {
      stopGrid();
      timerSync.destroy();
      commentsSync.destroy();
      timerSyncRef.current = null;
      sceneUnsubscribe();
      votingSync.destroy();
      votingControllerRef.current = null;
      allVotedWatch.destroy();
      allVotedRef.current = null;
      awarenessRef.current = null;
      docRef.current = null;
      followController.destroy();
      followRef.current = null;
      setFollow(NOT_FOLLOWING);
      presence.destroy();
      presenceRef.current = null;
      client.destroy();
      offlineWork.destroy();
      binding.destroy();
      bindingRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [epoch]);

  // The others learn who this client is for a voting, and how many votes it has placed in it, when that changes.
  useEffect(() => {
    const awareness = awarenessRef.current;
    if (!awareness) return;
    publishVoter(awareness, voterState());
    allVotedRef.current?.check();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, readOnly, voting]);

  // A switch of the theme (the host's attribute, the system, Excalidraw's own toggle) maps the sticky notes of the scene again.
  useEffect(() => {
    bindingRef.current?.setTheme(activeTheme);
  }, [activeTheme]);

  // The host changed the name or color after the canvas started.
  useEffect(() => {
    presenceRef.current?.identityChanged(identityNow.current);
  }, [identity.id, identity.name, identity.color]);

  // Esc ends following (#848): of a person, or of the presenter, whom anybody may step out of.
  const following = follow.following !== null;
  useEffect(() => {
    if (!following) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') followRef.current?.stop();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [following]);

  /** Runs a change of the board's shared state (the timer); rejects when the canvas is read-only or not up, or when the change is invalid. */
  const timerCommand = (run: (doc: Y.Doc) => unknown): Promise<void> => {
    if (readOnlyRef.current) return Promise.reject(new Error(tRef.current.errorReadOnly));
    const doc = docRef.current;
    if (!doc) return Promise.reject(new Error(tRef.current.errorNotReady));
    try {
      run(doc);
      return Promise.resolve();
    } catch (error) {
      return Promise.reject(error instanceof Error ? error : new Error(String(error)));
    }
  };

  /** What this client tells the others for a voting: who it is and how many votes it has placed. */
  const voterState = () => ({
    id: userIdRef.current ?? identityNow.current.id,
    votingId: votingRef.current.openSessionId,
    votes: votingRef.current.view?.myVotes ?? 0,
  });

  /** A vote for an element in the open voting; the server decides (no vote left, closed) and the badges follow its answer. */
  const voteFor = (elementId: string) => void votingControllerRef.current?.vote(elementId);
  const retractFor = (elementId: string) => void votingControllerRef.current?.retract(elementId);

  /** A command of the facilitator to the voting: editors only, and only with a host that gave a `votingApi`. */
  const votingCommand = (run: (voting: VotingController) => Promise<void>): Promise<void> => {
    if (readOnlyRef.current) return Promise.reject(new Error(tRef.current.errorReadOnly));
    const controller = votingControllerRef.current;
    if (!controller || !votingApiRef.current)
      return Promise.reject(new Error(tRef.current.errorNotReady));
    return run(controller);
  };

  /** Who writes a comment: the host's user id (what a mention and the delete rule go by), else the tab's own. */
  const commentAuthor = () => ({
    id: userIdRef.current ?? identityNow.current.id,
    name: identityNow.current.name,
  });

  /** What a thread hangs on, in words; `null` when its element is gone. */
  const describeAnchor = (anchor: CommentAnchor): string | null => {
    if (!('elementId' in anchor)) return tRef.current.commentOnPoint;
    const all = apiRef.current?.getSceneElements() ?? [];
    const element = all.find((candidate) => candidate.id === anchor.elementId);
    return element ? elementLabel(element, all) : null;
  };

  const commentDoc = (): Y.Doc => {
    const doc = docRef.current;
    if (!doc) throw new Error(tRef.current.errorNotReady);
    return doc;
  };
  const startComment = (text: string, names: MentionNames) => {
    const anchor = pendingAnchor;
    if (!anchor) throw new Error(tRef.current.errorNotReady);
    const id = addThread(commentDoc(), anchor, text, commentAuthor(), Date.now(), names);
    setPendingAnchor(null);
    setActiveThread(id);
  };
  const replyToThread = (threadId: string, text: string, names: MentionNames) =>
    addReply(commentDoc(), threadId, text, commentAuthor(), Date.now(), names);
  const resolveThread = (threadId: string, resolved: boolean) =>
    setResolved(commentDoc(), threadId, resolved, commentAuthor());
  const deleteComment = (threadId: string, messageId: string) =>
    void deleteMessage(commentDoc(), threadId, messageId);

  /** Opens the comments with the tool armed, or closes them. */
  const toggleComments = () => {
    if (commentsOpen) {
      setCommentsOpen(false);
      setPlacing(false);
      setPendingAnchor(null);
      return;
    }
    openComments(null);
  };
  const openComments = (threadId: string | null) => {
    setHistoryOpen(false); // both panels sit on the right edge
    setCommentsOpen(true);
    setActiveThread(threadId);
    setPlacing(threadId === null);
    setPendingAnchor(null);
    // The people to offer for `@`, asked for each time the panel opens (members change).
    void Promise.resolve(mentionDirectoryRef.current?.())
      .then((people) => setDirectory(people ?? []))
      .catch(() => setDirectory([]));
  };
  /** Opens or closes the History panel (#846); the comments make room for it. */
  const toggleHistory = () => {
    if (!snapshotApiRef.current) return;
    setHistoryOpen((open) => !open);
    setCommentsOpen(false);
    setPlacing(false);
    setPendingAnchor(null);
  };
  const toggleHistoryRef = useRef(toggleHistory);
  toggleHistoryRef.current = toggleHistory;
  // Alt+H opens the history. `code`, not `key`: with Option held a Mac types another character. Like the grid shortcut it is
  // the canvas's only when the focus is on the page body or inside the canvas, and like it it is caught in the capture
  // phase: once a shape was drawn the focus is on Excalidraw's container, whose key handler stops the key from bubbling.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.code !== 'KeyH' || !event.altKey || event.ctrlKey || event.metaKey) return;
      if (event.repeat || event.defaultPrevented) return;
      const target = event.target as Node | null;
      if (target !== document.body && !rootRef.current?.contains(target)) return;
      // Not while typing: a version name in the History panel, a text being edited, an IME composition.
      if (isTextEntry(event, apiRef.current)) return;
      event.preventDefault();
      event.stopPropagation();
      toggleHistoryRef.current();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);
  const describeAnchorRef = useRef(describeAnchor);
  describeAnchorRef.current = describeAnchor;
  const toggleCommentsRef = useRef(toggleComments);
  toggleCommentsRef.current = toggleComments;
  const placeComment = (anchor: CommentAnchor) => {
    setPendingAnchor(anchor);
    setPlacing(false);
    setActiveThread(null);
  };
  /** Pans the view to what a thread hangs on. */
  const showThread = (threadId: string) => {
    const thread = threadsRef.current.find((candidate) => candidate.id === threadId);
    const api = apiRef.current;
    if (!thread || !api) return;
    setActiveThread(threadId);
    if ('elementId' in thread.anchor) {
      const id = thread.anchor.elementId;
      const target = api.getSceneElements().find((element) => element.id === id);
      if (target) api.scrollToContent(target, { fitToViewport: false, animate: true });
    } else {
      panTo(thread.anchor);
    }
  };
  // Escape leaves the tool.
  useEffect(() => {
    if (!placing) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setPlacing(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [placing]);
  const commentNames = knownNames(threads, directory);
  // The host's list first; an author or a name kept with a mention who is not on it by name is added (a person has one id
  // in the host's list and another as an author, and should be offered once).
  const commentPeople: Person[] = [...directory];
  for (const [id, name] of commentNames) {
    if (!commentPeople.some((person) => person.name === name)) commentPeople.push({ id, name });
  }

  const panTo = (center: { x: number; y: number }) => {
    const snapshot = sceneStoreRef.current.get();
    if (!snapshot) return;
    apiRef.current?.updateScene({
      appState: scrollToCenter(center, snapshot),
      captureUpdate: CaptureUpdateAction.NEVER,
    });
  };

  /** Zooms about the middle of the view, so what is in the middle stays there. */
  const zoomTo = (value: number) => {
    const api = apiRef.current;
    if (!api) return;
    const { scrollX, scrollY, zoom, width, height } = api.getAppState();
    const next = zoomAbout({ scrollX, scrollY, zoom: zoom.value, width, height }, value);
    api.updateScene({
      appState: {
        zoom: { value: next.zoom as typeof zoom.value },
        scrollX: next.scrollX,
        scrollY: next.scrollY,
      },
      captureUpdate: CaptureUpdateAction.NEVER,
    });
  };

  const onZoom = (action: ZoomAction) => {
    const api = apiRef.current;
    if (!api) return;
    const current = api.getAppState().zoom.value;
    if (action === 'in') zoomTo(current + ZOOM_STEP);
    else if (action === 'out') zoomTo(current - ZOOM_STEP);
    else if (action === 'reset') zoomTo(1);
    else {
      const elements = api.getSceneElements();
      if (elements.length === 0) zoomTo(1);
      else
        api.scrollToContent(elements, {
          fitToViewport: true,
          viewportZoomFactor: 0.9,
          animate: true,
        });
    }
  };

  /**
   * Undo and redo have no public API in Excalidraw 0.18, so the toolbar presses the shortcut on the
   * canvas: its own handler then does exactly what the keyboard does (and keeps the history in one place).
   */
  const onHistory = (action: HistoryAction) => {
    const target = rootRef.current?.querySelector<HTMLElement>('.excalidraw');
    if (!target) return;
    target.focus({ preventScroll: true });
    target.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'z',
        code: 'KeyZ',
        // Excalidraw reads Ctrl or Cmd depending on the platform; sending both is correct on each.
        ctrlKey: true,
        metaKey: true,
        shiftKey: action === 'redo',
        bubbles: true,
        cancelable: true,
      }),
    );
  };

  /** Connects the two selected elements (the button and the key C): first picked to second picked, else left to right. */
  const connectSelection = () => {
    const api = apiRef.current;
    if (!api || readOnlyRef.current) return;
    const elements = api.getSceneElements();
    const pair = connectableSelection(elements, api.getAppState().selectedElementIds);
    if (!pair) return;
    const { ids, known } = selectionOrder.current;
    const picked = known ? [...pair].sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id)) : pair;
    const { source, target } = connectorDirection(picked[0], picked[1], known);
    const existing = findConnector(elements, source.id, target.id);
    if (existing) {
      // Already connected this way: no second connector, the existing one is selected.
      api.updateScene({
        appState: { selectedElementIds: { [existing.id]: true } },
        captureUpdate: CaptureUpdateAction.NEVER,
      });
      return;
    }
    commitConnector(api, createConnector(elements, source.id, target.id));
  };
  const connectSelectionRef = useRef(connectSelection);
  connectSelectionRef.current = connectSelection;

  // The keys C (connect the two selected elements) and N (a sticky note in the current color). Not with a modifier
  // (Ctrl+C is copy), not while typing, and not while a text is being edited. `addSticky` is defined further down.
  const addStickyRef = useRef<(color: StickyColor) => void>(() => {});
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      if ((key !== 'c' && key !== 'n') || event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.repeat || event.defaultPrevented) return;
      if (isTextEntry(event, apiRef.current)) return;
      if (key === 'c') {
        // C connects two selected elements; with nothing to connect it opens the comments (#733).
        const api = apiRef.current;
        const connectable =
          !readOnlyRef.current &&
          api &&
          connectableSelection(api.getSceneElements(), api.getAppState().selectedElementIds) !==
            null;
        if (connectable) connectSelectionRef.current();
        else toggleCommentsRef.current();
      } else if (!readOnlyRef.current) addStickyRef.current(stickyColorRef.current);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Object snapping is Excalidraw state, not a controlled prop: the setting is put into it when it changes (and for a viewer's
  // canvas it is off), and `onChange` puts it back when Excalidraw's own Alt+S or menu item changed it.
  const guidesOn = grid.guides && !readOnly;
  const guidesOnRef = useRef(guidesOn);
  guidesOnRef.current = guidesOn;
  useEffect(() => {
    apiRef.current?.updateScene({
      appState: { objectsSnapModeEnabled: guidesOn },
      captureUpdate: CaptureUpdateAction.NEVER,
    });
  }, [guidesOn]);
  // The dots and Excalidraw's grid size follow the setting, whoever changed it.
  useEffect(() => {
    const api = apiRef.current;
    if (!api) return;
    api.updateScene({
      appState: { gridSize: grid.size },
      captureUpdate: CaptureUpdateAction.NEVER,
    });
    const state = api.getAppState();
    if (rootRef.current) {
      applyGridDots(rootRef.current, {
        zoom: state.zoom.value,
        scrollX: state.scrollX,
        scrollY: state.scrollY,
        size: grid.size,
      });
    }
  }, [grid.size]);
  // Excalidraw's own shortcut for its grid (Ctrl+') toggles the dots here: its line grid is switched off in the build
  // (vite-plugin-excalidraw-no-grid.ts) and its grid mode means snapping. Caught before Excalidraw sees it.
  useEffect(() => {
    // Excalidraw listens on the document, so this is on the window, in the capture phase; a key typed into another
    // field of the page (a dialog of the shell, a text box) is not the canvas's.
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "'" || !(event.ctrlKey || event.metaKey) || event.altKey) return;
      const target = event.target as Node | null;
      if (target !== document.body && !rootRef.current?.contains(target)) return;
      event.preventDefault();
      event.stopPropagation();
      changeGridRef.current({ show: !gridRef.current.show });
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);

  /** A change of the grid goes into the document (editors only); every client, this one too, takes it from there. */
  const changeGrid = (change: Partial<GridSettings>) => {
    const doc = docRef.current;
    if (doc && !readOnlyRef.current) writeGrid(doc, change);
  };
  changeGridRef.current = changeGrid;
  const setGridShown = (show: boolean) => changeGrid({ show });
  const setGridSize = (size: GridSize) => changeGrid({ size });

  /** Presses a key on the canvas, for what Excalidraw offers only as a shortcut (undo, the help dialog). */
  const pressKey = (init: KeyboardEventInit) => {
    const target = rootRef.current?.querySelector<HTMLElement>('.excalidraw');
    if (!target) return;
    target.focus({ preventScroll: true });
    target.dispatchEvent(
      new KeyboardEvent('keydown', { ...init, bubbles: true, cancelable: true }),
    );
  };

  /** Removes everything from the board, as tombstones (a sync-safe delete), in one undo step. */
  const clearBoard = () => {
    const api = apiRef.current;
    if (!api || readOnlyRef.current) return;
    api.updateScene({
      elements: clearScene(api.getSceneElementsIncludingDeleted()),
      appState: { selectedElementIds: {} },
      captureUpdate: CaptureUpdateAction.IMMEDIATELY,
    });
  };

  const menuItems: CanvasMenuItem[] = [
    { type: 'heading', label: t.menuView },
    {
      type: 'check',
      id: 'grid-show',
      label: t.menuShowGrid,
      checked: grid.show,
      disabled: readOnly,
      onSelect: () => setGridShown(!grid.show),
    },
    {
      type: 'check',
      id: 'grid-snap',
      label: t.menuSnapToGrid,
      checked: grid.snap,
      disabled: readOnly,
      onSelect: () => changeGrid({ snap: !grid.snap }),
    },
    {
      type: 'check',
      id: 'snap-objects',
      label: t.menuSnapToObjects,
      checked: grid.guides,
      disabled: readOnly,
      onSelect: () => changeGrid({ guides: !grid.guides }),
    },
    // The grid belongs to the board: a viewer sees it and does not change it.
    { type: 'heading', label: readOnly ? t.menuGridSizeReadOnly : t.menuGridSize },
    ...GRID_SIZES.map((size) => ({
      type: 'radio' as const,
      id: `grid-size-${size}`,
      label: t.menuGridSizeOption(size),
      checked: grid.size === size,
      disabled: readOnly,
      keepOpen: true,
      onSelect: () => setGridSize(size),
    })),
    { type: 'heading', label: t.menuCanvas },
    {
      type: 'item',
      id: 'history',
      label: t.menuHistory,
      hint: 'Alt+H',
      disabled: !snapshotApi,
      onSelect: toggleHistory,
    },
    {
      type: 'item',
      id: 'help',
      label: t.menuHelp,
      hint: '?',
      onSelect: () => pressKey({ key: '?', code: 'Slash', shiftKey: true }),
    },
    ...(readOnly
      ? []
      : [
          {
            type: 'item' as const,
            id: 'clear',
            label: t.menuClear,
            onSelect: clearBoard,
            confirm: {
              message: t.clearMessage,
              accept: t.clearAccept,
              decline: t.clearDecline,
            },
          },
        ]),
  ];

  const addSticky = (color: StickyColor) => {
    const api = apiRef.current;
    if (!api) return;
    setStickyColor(color);
    writeStickyColor(color);
    const { scrollX, scrollY, zoom, width, height } = api.getAppState();
    const center = {
      x: width / 2 / zoom.value - scrollX,
      y: height / 2 / zoom.value - scrollY,
    };
    const note = createStickyNote(color, center);
    api.updateScene({
      elements: [...api.getSceneElementsIncludingDeleted(), ...note],
      appState: { selectedElementIds: { [note[0].id]: true } },
      captureUpdate: CaptureUpdateAction.IMMEDIATELY,
    });
    api.setActiveTool({ type: 'selection' });
  };

  addStickyRef.current = addSticky;

  return (
    <I18nProvider locale={locale}>
      <div
        ref={rootRef}
        className="elysion-canvas"
        onDropCapture={onDropCapture}
        data-theme={activeTheme}
        data-grid={grid.show ? 'dots' : undefined}
        data-comment-mode={placing ? '' : undefined}
        style={{ position: 'absolute', inset: 0 }}
      >
        {pdfFile && excalidrawApi && (
          <Suspense fallback={null}>
            <PdfImportDialog file={pdfFile} api={excalidrawApi} onDone={finishPdf} />
          </Suspense>
        )}
        <Excalidraw
          theme={activeTheme}
          langCode={excalidrawLangCode(locale)}
          viewModeEnabled={readOnly}
          // Excalidraw's grid mode is snapping (its lines are switched off, the dots are ours): set by the setting, never by the user's keys.
          gridModeEnabled={grid.snap && !readOnly}
          // Snap to the edges and centers of other elements, with guide lines: a board setting too (#755). Excalidraw reads this
          // prop once, for its first state; after that the setting is put into its state (below), and kept there.
          objectsSnapModeEnabled={grid.guides && !readOnly}
          UIOptions={imagesEnabled ? UI_OPTIONS_WITH_IMAGES : UI_OPTIONS}
          initialData={{
            appState: {
              ...ELEMENT_DEFAULTS,
              // Transparent: the board's color and the dots are the background behind the canvas (styles/grid.css).
              viewBackgroundColor: 'transparent',
              gridSize: gridRef.current.size,
            },
          }}
          onLibraryChange={(items) => LIBRARY_ADAPTER.save({ libraryItems: items })}
          excalidrawAPI={(api) => {
            apiRef.current = api;
            setExcalidrawApi(api);
            // The size the document gave before the canvas was there (the initial state has the default one).
            if (gridRef.current.size !== DEFAULT_GRID.size) {
              api.updateScene({
                appState: { gridSize: gridRef.current.size },
                captureUpdate: CaptureUpdateAction.NEVER,
              });
            }
            bindingRef.current?.attach(api);
            presenceRef.current?.refresh(); // the collaborators that were there before the canvas was
            followRef.current?.refresh(); // and the one this client is to follow
            controlsCallback.current?.({
              whenSettled: (timeoutMs) =>
                bindingRef.current?.whenSettled(timeoutMs) ?? Promise.resolve(),
              toggleLibrary: () => api.toggleSidebar({ name: LIBRARY_SIDEBAR, tab: LIBRARY_TAB }),
              exportBoard: (format, options) =>
                exportBoard(
                  api,
                  format,
                  options,
                  options?.comments
                    ? buildAppendix(
                        threadsRef.current,
                        knownNames(threadsRef.current, []),
                        tRef.current,
                        locale,
                        describeAnchorRef.current,
                      )
                    : null,
                ),
              exportThumbnail: () => exportThumbnail(api),
              importFile: (file) =>
                readOnlyRef.current
                  ? Promise.reject(new Error(tRef.current.errorReadOnly))
                  : importFile(api, file),
              importPdf: (file) => startPdfRef.current(file),
              insertFile: (file) =>
                readOnlyRef.current
                  ? Promise.reject(new Error(tRef.current.errorReadOnly))
                  : insertFile(api, file),
              startTimer: (durationMs) =>
                timerCommand((doc) =>
                  startTimer(doc, durationMs, {
                    id: userIdRef.current ?? identityNow.current.id,
                    name: identityNow.current.name,
                  }),
                ),
              pauseTimer: () => timerCommand((doc) => pauseTimer(doc)),
              resumeTimer: () => timerCommand((doc) => resumeTimer(doc)),
              extendTimer: (ms) => timerCommand((doc) => extendTimer(doc, ms)),
              stopTimer: () => timerCommand((doc) => stopTimer(doc)),
              startVoting: (options) => votingCommand((controller) => controller.start(options)),
              endVoting: () => votingCommand((controller) => controller.end()),
              // All the results: every closed voting goes, so an older one does not show up after the last was cleared.
              clearVotingResults: () => votingCommand((controller) => controller.clear()),
              follow: (personId) => {
                const controller = followRef.current;
                if (!controller) return Promise.reject(new Error(tRef.current.errorNotReady));
                return controller.follow(personId)
                  ? Promise.resolve()
                  : Promise.reject(new Error(tRef.current.errorNotOnBoardPerson));
              },
              stopFollowing: () => {
                followRef.current?.stop();
                return Promise.resolve();
              },
              followPresenter: () => {
                followRef.current?.followPresenter();
                return Promise.resolve();
              },
              startPresenting: () =>
                timerCommand((doc) => {
                  const presenter = followRef.current?.state.presenter;
                  if (presenter && !presenter.me && !canModerateRef.current) {
                    throw new Error(tRef.current.errorPresenterBusy);
                  }
                  startPresenting(doc, identityNow.current.id);
                }),
              stopPresenting: () =>
                timerCommand((doc) => {
                  const entry = readPresenter(doc);
                  const live = followRef.current?.state.presenter;
                  if (
                    entry &&
                    entry.userId !== identityNow.current.id &&
                    live &&
                    !canModerateRef.current
                  ) {
                    throw new Error(tRef.current.errorNotPresenter);
                  }
                  stopPresenting(doc);
                }),
              summonEveryone: () =>
                timerCommand((doc) => {
                  const { scrollX, scrollY, zoom, width, height } = api.getAppState();
                  summonEveryone(
                    doc,
                    identityNow.current.id,
                    viewportOf({ scrollX, scrollY, zoom: zoom.value }, { width, height }),
                  );
                }),
              scrollToElement: (elementId) => {
                const target = api.getSceneElements().find((element) => element.id === elementId);
                if (!target) return Promise.reject(new Error(tRef.current.errorNotOnBoard));
                api.scrollToContent(target, { fitToViewport: false, animate: true });
                return Promise.resolve();
              },
            });
          }}
          onPointerUpdate={(update) => presenceRef.current?.pointerMoved(update)}
          onChange={(elements, appState, files) => {
            bindingRef.current?.onLocalChange(elements, files);
            presenceRef.current?.selectionChanged(appState.selectedElementIds);
            {
              const view = {
                scrollX: appState.scrollX,
                scrollY: appState.scrollY,
                zoom: appState.zoom.value,
              };
              const size = { width: appState.width, height: appState.height };
              // The follow controller first: a view it made itself must not be taken for the person's panning.
              followRef.current?.viewChanged(view, size);
              if (size.width > 0 && size.height > 0) {
                presenceRef.current?.viewportChanged(viewportOf(view, size));
              }
            }
            setActiveTool(appState.activeTool.type);
            if (appState.objectsSnapModeEnabled !== guidesOnRef.current) {
              apiRef.current?.updateScene({
                appState: { objectsSnapModeEnabled: guidesOnRef.current },
                captureUpdate: CaptureUpdateAction.NEVER,
              });
            }
            if (rootRef.current) {
              applyGridDots(rootRef.current, {
                zoom: appState.zoom.value,
                scrollX: appState.scrollX,
                scrollY: appState.scrollY,
                size: gridRef.current.size,
              });
            }
            selectionOrder.current = trackSelection(
              selectionOrder.current,
              appState.selectedElementIds,
            );
            setCanConnect(connectableSelection(elements, appState.selectedElementIds) !== null);
            setZoomPercent(Math.round(appState.zoom.value * 100));
            const selected = Object.values(appState.selectedElementIds).filter(Boolean).length;
            if (selected !== selectionCount.current) {
              selectionCount.current = selected;
              selectionCallback.current?.(selected);
            }
            const open = appState.openSidebar?.name === LIBRARY_SIDEBAR;
            if (open !== libraryOpen.current) {
              libraryOpen.current = open;
              libraryCallback.current?.(open);
            }
            if (appState.theme !== lastReportedTheme.current) {
              lastReportedTheme.current = appState.theme;
              if (appState.theme !== activeTheme) {
                setActiveTheme(appState.theme);
                themeCallback.current?.(appState.theme);
              }
            }
            sceneStoreRef.current.set({
              elements: elements.filter((element) => !element.isDeleted),
              scrollX: appState.scrollX,
              scrollY: appState.scrollY,
              zoom: appState.zoom.value,
              width: appState.width,
              height: appState.height,
            });
          }}
        >
          {/* Our own trigger replaces Excalidraw's floating Library button; the top bar opens the library. */}
          <DefaultSidebar.Trigger style={{ display: 'none' }} aria-hidden="true" />
        </Excalidraw>
        <Minimap store={sceneStoreRef.current} onPan={panTo} />
        <FollowOverlay
          state={follow}
          onFollowPresenter={() => followRef.current?.followPresenter()}
        />
        {!readOnly && (
          <ConnectionPoints apiRef={apiRef} rootRef={rootRef} store={sceneStoreRef.current} />
        )}
        <VoteBadges
          apiRef={apiRef}
          rootRef={rootRef}
          store={sceneStoreRef.current}
          voting={voting}
          readOnly={readOnly}
          onVote={voteFor}
          onRetract={retractFor}
        />
        <CommentLayer
          apiRef={apiRef}
          rootRef={rootRef}
          store={sceneStoreRef.current}
          threads={threads}
          placing={placing}
          activeId={commentsOpen ? activeThread : null}
          onPlace={placeComment}
          onOpen={(threadId) => openComments(threadId)}
        />
        {commentsOpen && (
          <CommentPanel
            threads={threads}
            me={commentAuthor()}
            moderate={canModerate}
            pending={pendingAnchor}
            activeId={activeThread}
            directory={commentPeople}
            search={mentionSearch ? searchPeople : undefined}
            names={commentNames}
            describeAnchor={describeAnchor}
            placing={placing}
            onStart={startComment}
            onReply={replyToThread}
            onResolve={resolveThread}
            onDelete={deleteComment}
            onNew={() => {
              setPendingAnchor(null);
              setActiveThread(null);
              setPlacing(true);
            }}
            onCancelNew={() => setPendingAnchor(null)}
            onShow={showThread}
            onClose={toggleComments}
          />
        )}
        {historyOpen && snapshotApi && (
          <HistoryPanel
            api={snapshotApi}
            readOnly={readOnly}
            canDelete={canModerate}
            canRestore={canModerate}
            onOpenBoard={(board) => openBoardCallback.current?.(board)}
            onClose={() => setHistoryOpen(false)}
          />
        )}
        <Toolbar
          activeTool={activeTool}
          onSelect={(tool: ToolbarTool) => apiRef.current?.setActiveTool({ type: tool })}
          onAddSticky={addSticky}
          stickyColor={stickyColor}
          theme={activeTheme}
          onHistory={onHistory}
          onConnect={canConnect && !readOnly ? connectSelection : undefined}
          onComments={toggleComments}
          commentsOpen={commentsOpen}
          onZoom={onZoom}
          zoomPercent={zoomPercent}
          menuItems={menuItems}
          readOnly={readOnly}
          imagesEnabled={imagesEnabled}
        />
      </div>
    </I18nProvider>
  );
}
