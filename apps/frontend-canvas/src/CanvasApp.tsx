import { useEffect, useRef, useState } from 'react';
import {
  exportBoard,
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
import { SceneStore } from './scene-store';
import { scrollToCenter } from './minimap-geometry';
import { ZOOM_STEP, zoomAbout } from './zoom';
import { Toolbar, type HistoryAction, type ToolbarTool, type ZoomAction } from './Toolbar';
import { ELEMENT_DEFAULTS } from './element-style';
import { applyGridDots } from './grid-dots';
import { createStickyNote, type StickyColor } from './sticky-note';
import { useResolvedTheme, type CanvasTheme } from './useResolvedTheme';
import { CaptureUpdateAction, DefaultSidebar, Excalidraw } from '@excalidraw/excalidraw';
import '@excalidraw/excalidraw/index.css';
import '@elysion/design-tokens/tokens.css';
import './styles/excalidraw-theme.css';
import './styles/grid.css';
import './styles/toolbar.css';
import './styles/connection-points.css';
import './styles/voting.css';
import type { ExcalidrawImperativeAPI, ToolType } from '@excalidraw/excalidraw/types';
import * as Y from 'yjs';
import { ExcalidrawYjsBinding } from './yjs/excalidraw-binding.js';
import type { FileStore } from './yjs/files.js';
import { YjsWebsocketClient, type YjsConnectionStatus } from './yjs/YjsWebsocketClient.js';
import { createSessionIdentity, withHostIdentity } from './presence/identity';
import type { PresentUser } from './presence/collaborators';
import type { Awareness } from 'y-protocols/awareness';
import { PresenceSync } from './presence/presence';
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
import { type VotingSnapshot, type VotingSync, observeVoting } from './facilitation/voting-sync';
import {
  type StartOptions,
  type VotingView,
  castVote,
  clearResults,
  retractVote,
  endSession,
  readVoting,
  startSession,
} from './facilitation/voting';

/** What the host can ask the canvas to do; the element exposes these as methods. */
export interface CanvasControls {
  /** Opens Excalidraw's library sidebar, or closes it when it is open. */
  toggleLibrary(): void;
  /** The board (or the selection) as a file, or `null` when there is nothing to export. */
  exportBoard(format: ExportFormat, options?: ExportOptions): Promise<Blob | null>;
  /** Replaces the board with the contents of an .excalidraw file; resolves with its element count. */
  importFile(file: Blob): Promise<number>;
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
   * Dot voting (ADR 0020), for everybody on the board; the first three reject on a read-only canvas and before the canvas
   * is up. `startVoting` rejects while a voting is open. The canvas keeps the state and announces it (`onVotingChange`).
   */
  startVoting(options: StartOptions): Promise<void>;
  /** Closes the open voting: nobody can vote any more and the result is shown. A no-op when none is open. */
  endVoting(): Promise<void>;
  /** Removes the results: every closed voting, with its votes. An open voting stays. A no-op when there are none. */
  clearVotingResults(): Promise<void>;
  /** Scrolls the view to an element (a result of the voting); rejects when it is not on the board. */
  scrollToElement(elementId: string): Promise<void>;
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
  /** The Yjs connection changed; also called once with `connecting` when the canvas starts. */
  onStatusChange?: (status: YjsConnectionStatus) => void;
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
   * The shared timer changed, on this client or another: its state, or `null` when there is none. Also called after
   * the connection was made, so somebody who joins while a timer runs gets it.
   */
  onTimerChange?: (state: TimerState | null) => void;
  /**
   * The voting changed, on this client or another: the current session as this person sees it (their own votes, the
   * result once it is closed), or `null`. Also called after the connection was made, so a late joiner gets it.
   */
  onVotingChange?: (view: VotingView | null) => void;
  /** The connection to the board server failed; the canvas keeps retrying, so this is news, not the end. */
  onError?: (error: Error) => void;
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
  /** An image could not be stored (the element is taken off the board again) or loaded; `message` says why. */
  onFileError?: (error: Error) => void;
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
  /** The name shown next to this user's cursor on other screens; a generated guest name when unset. */
  userName?: string;
  /** Who this user is (the identity provider's id): what the timer remembers about who started it. A per-tab id when unset. */
  userId?: string;
  /** The color of this user's cursor, `#rrggbb`; one picked from the palette when unset or not valid. */
  userColor?: string;
}

const NO_VOTING: VotingSnapshot = { view: null, own: {}, openSessionId: null };

function defaultYjsServerUrl(): string {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}/yjs`;
}

// Excalidraw only offers its own light/dark toggle when it is not given a `theme`; we always pass one
// (the host or the system decides), so the toggle has to be switched on explicitly.
const UI_OPTIONS = { canvasActions: { toggleTheme: true }, tools: { image: false } };
const UI_OPTIONS_WITH_IMAGES = { canvasActions: { toggleTheme: true }, tools: { image: true } };

// Excalidraw's own library: the default sidebar, on its library tab.
const LIBRARY_SIDEBAR = 'default';
const LIBRARY_TAB = 'library';

export function CanvasApp({
  boardId = 'default',
  yjsServerUrl,
  theme,
  onStatusChange,
  onThemeChange,
  onControls,
  onLibraryChange,
  onSelectionCount,
  onPresenceChange,
  onTimerChange,
  onVotingChange,
  onError,
  tokenProvider,
  fileStore,
  onFileError,
  readOnly = false,
  imagesEnabled = false,
  userName,
  userId,
  userColor,
}: CanvasAppProps) {
  const resolvedTheme = useResolvedTheme(theme);
  // What is shown right now: a toggle inside Excalidraw changes it, and so does a new `theme`
  // attribute or system preference (which wins over an earlier toggle).
  const [activeTheme, setActiveTheme] = useState<CanvasTheme>(resolvedTheme);
  useEffect(() => setActiveTheme(resolvedTheme), [resolvedTheme]);
  // The theme Excalidraw last reported. It lags behind `activeTheme` for a moment after the host
  // changed the attribute, so a mismatch alone does not mean the user switched it: only a change of
  // Excalidraw's own value does.
  const lastReportedTheme = useRef<CanvasTheme>(resolvedTheme);
  // Callbacks are read through refs: the connection below is created once per mount.
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
  const timerCallback = useRef(onTimerChange);
  timerCallback.current = onTimerChange;
  const votingCallback = useRef(onVotingChange);
  votingCallback.current = onVotingChange;
  const errorCallback = useRef(onError);
  presenceCallback.current = onPresenceChange;
  errorCallback.current = onError;
  const tokenProviderRef = useRef(tokenProvider);
  tokenProviderRef.current = tokenProvider;
  const fileStoreRef = useRef(fileStore);
  fileStoreRef.current = fileStore;
  const fileErrorCallback = useRef(onFileError);
  fileErrorCallback.current = onFileError;
  const readOnlyRef = useRef(readOnly);
  readOnlyRef.current = readOnly;
  const apiRef = useRef<ExcalidrawImperativeAPI | null>(null);
  const bindingRef = useRef<ExcalidrawYjsBinding | null>(null);
  const presenceRef = useRef<PresenceSync | null>(null);
  const docRef = useRef<Y.Doc | null>(null);
  const timerSyncRef = useRef<TimerSync | null>(null);
  const votingSyncRef = useRef<VotingSync | null>(null);
  const awarenessRef = useRef<Awareness | null>(null);
  const allVotedRef = useRef<AllVotedWatch | null>(null);
  // The voting as this person sees it: what the badges and the vote mode work from (see the voting section below).
  const [voting, setVoting] = useState<VotingSnapshot>(NO_VOTING);
  const votingRef = useRef(voting);
  votingRef.current = voting;
  const userIdRef = useRef(userId);
  userIdRef.current = userId;
  // Who this tab is, made once: a re-render must not make a new collaborator.
  const identityRef = useRef(createSessionIdentity());
  const identity = withHostIdentity(identityRef.current, userName, userColor);
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
    // A person is told apart by the host's user id, else by the tab's own id (so votes are per tab then).
    const votingSync = observeVoting(
      doc,
      () => userIdRef.current ?? identityNow.current.id,
      (snapshot) => {
        setVoting(snapshot);
        votingCallback.current?.(snapshot.view);
      },
    );
    votingSyncRef.current = votingSync;
    const binding = new ExcalidrawYjsBinding(doc, {
      fileStore: () => fileStoreRef.current,
      onError: (error) => fileErrorCallback.current?.(error),
    });
    bindingRef.current = binding;
    if (apiRef.current) {
      binding.attach(apiRef.current);
    }

    const url = new URL(yjsServerUrl ?? defaultYjsServerUrl());
    url.searchParams.set('board', boardId);
    const client = new YjsWebsocketClient(url.toString(), doc, {
      onStatusChange: (status) => {
        statusCallback.current?.(status);
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

    const presence = new PresenceSync(
      client.awareness,
      identityNow.current,
      () => apiRef.current,
      (users) => presenceCallback.current?.(users),
    );
    presenceRef.current = presence;

    // Who this client is for a voting, and the watch that ends it once everybody present has used all their votes.
    // After the presence sync, which sets the awareness state as a whole.
    awarenessRef.current = client.awareness;
    publishVoter(client.awareness, {
      id: userIdRef.current ?? identityNow.current.id,
      canVote: !readOnlyRef.current,
    });
    const allVotedWatch = watchAllVoted(doc, client.awareness, () => !readOnlyRef.current);
    allVotedRef.current = allVotedWatch;

    return () => {
      stopGrid();
      timerSync.destroy();
      timerSyncRef.current = null;
      votingSync.destroy();
      votingSyncRef.current = null;
      allVotedWatch.destroy();
      allVotedRef.current = null;
      awarenessRef.current = null;
      docRef.current = null;
      presence.destroy();
      presenceRef.current = null;
      client.destroy();
      binding.destroy();
      bindingRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The host gave the user id after the canvas started: the votes are somebody else's now, or this person's own.
  const lastUserId = useRef(userId);
  useEffect(() => {
    if (lastUserId.current === userId) return;
    lastUserId.current = userId;
    votingSyncRef.current?.emit();
  }, [userId]);

  // The others learn who this client is for a voting, and whether it may vote, when that changes.
  useEffect(() => {
    const awareness = awarenessRef.current;
    if (!awareness) return;
    publishVoter(awareness, { id: userId ?? identityNow.current.id, canVote: !readOnly });
    allVotedRef.current?.check();
  }, [userId, readOnly]);

  // The host changed the name or color after the canvas started.
  useEffect(() => {
    presenceRef.current?.identityChanged(identityNow.current);
  }, [identity.name, identity.color]);

  /** Runs a change of the board's shared state (the timer, the voting); rejects when the canvas is read-only or not up, or when the change is invalid. */
  const timerCommand = (run: (doc: Y.Doc) => unknown): Promise<void> => {
    if (readOnlyRef.current) return Promise.reject(new Error('This board is read-only.'));
    const doc = docRef.current;
    if (!doc) return Promise.reject(new Error('The canvas is not ready yet.'));
    try {
      run(doc);
      return Promise.resolve();
    } catch (error) {
      return Promise.reject(error instanceof Error ? error : new Error(String(error)));
    }
  };

  /** Who this person is for the voting: the host's user id, else the tab's own. */
  const voter = () => ({
    id: userIdRef.current ?? identityNow.current.id,
    name: identityNow.current.name,
  });

  /** A vote for an element in the open voting; the document decides (no vote left, closed) and the badges follow it. */
  const voteFor = (elementId: string) => {
    const doc = docRef.current;
    const sessionId = votingRef.current.openSessionId;
    if (doc && sessionId && !readOnlyRef.current) castVote(doc, sessionId, voter().id, elementId);
  };
  const retractFor = (elementId: string) => {
    const doc = docRef.current;
    const sessionId = votingRef.current.openSessionId;
    if (doc && sessionId && !readOnlyRef.current)
      retractVote(doc, sessionId, voter().id, elementId);
  };

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
      const target = event.target;
      if (
        target instanceof Element &&
        target.closest('input, textarea, select, [contenteditable="true"]')
      ) {
        return;
      }
      if (apiRef.current?.getAppState().editingTextElement) return;
      if (key === 'c') connectSelectionRef.current();
      else if (!readOnlyRef.current) addStickyRef.current(stickyColorRef.current);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

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
    { type: 'heading', label: 'View' },
    {
      type: 'check',
      id: 'grid-show',
      label: 'Show grid',
      checked: grid.show,
      disabled: readOnly,
      onSelect: () => setGridShown(!grid.show),
    },
    {
      type: 'check',
      id: 'grid-snap',
      label: 'Snap to grid',
      checked: grid.snap,
      disabled: readOnly,
      onSelect: () => changeGrid({ snap: !grid.snap }),
    },
    // The grid belongs to the board: a viewer sees it and does not change it.
    { type: 'heading', label: readOnly ? 'Grid size (set by the editors)' : 'Grid size' },
    ...GRID_SIZES.map((size) => ({
      type: 'radio' as const,
      id: `grid-size-${size}`,
      label: `${size} px`,
      checked: grid.size === size,
      disabled: readOnly,
      keepOpen: true,
      onSelect: () => setGridSize(size),
    })),
    { type: 'heading', label: 'Canvas' },
    {
      type: 'item',
      id: 'help',
      label: 'Help',
      hint: '?',
      onSelect: () => pressKey({ key: '?', code: 'Slash', shiftKey: true }),
    },
    ...(readOnly
      ? []
      : [
          {
            type: 'item' as const,
            id: 'clear',
            label: 'Clear canvas…',
            onSelect: clearBoard,
            confirm: {
              message: 'Remove everything from this board, for everyone? You can undo it.',
              accept: 'Clear everything',
              decline: 'Keep it',
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
    <div
      ref={rootRef}
      className="elysion-canvas"
      data-theme={activeTheme}
      data-grid={grid.show ? 'dots' : undefined}
      style={{ position: 'absolute', inset: 0 }}
    >
      <Excalidraw
        theme={activeTheme}
        viewModeEnabled={readOnly}
        // Excalidraw's grid mode is snapping (its lines are switched off, the dots are ours): set by the setting, never by the user's keys.
        gridModeEnabled={grid.snap && !readOnly}
        UIOptions={imagesEnabled ? UI_OPTIONS_WITH_IMAGES : UI_OPTIONS}
        initialData={{
          appState: {
            ...ELEMENT_DEFAULTS,
            // Transparent: the board's color and the dots are the background behind the canvas (styles/grid.css).
            viewBackgroundColor: 'transparent',
            gridSize: gridRef.current.size,
          },
        }}
        excalidrawAPI={(api) => {
          apiRef.current = api;
          // The size the document gave before the canvas was there (the initial state has the default one).
          if (gridRef.current.size !== DEFAULT_GRID.size) {
            api.updateScene({
              appState: { gridSize: gridRef.current.size },
              captureUpdate: CaptureUpdateAction.NEVER,
            });
          }
          bindingRef.current?.attach(api);
          presenceRef.current?.refresh(); // the collaborators that were there before the canvas was
          controlsCallback.current?.({
            toggleLibrary: () => api.toggleSidebar({ name: LIBRARY_SIDEBAR, tab: LIBRARY_TAB }),
            exportBoard: (format, options) => exportBoard(api, format, options),
            importFile: (file) =>
              readOnlyRef.current
                ? Promise.reject(new Error('This board is read-only.'))
                : importFile(api, file),
            insertFile: (file) =>
              readOnlyRef.current
                ? Promise.reject(new Error('This board is read-only.'))
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
            startVoting: (options) => timerCommand((doc) => startSession(doc, options, voter())),
            endVoting: () =>
              timerCommand((doc) => {
                const open = readVoting(doc).openSessionId;
                if (open) endSession(doc, open);
              }),
            // All the results: every closed voting goes, so an older one does not show up after the last was cleared.
            clearVotingResults: () =>
              timerCommand((doc) => {
                for (const session of readVoting(doc).sessions) {
                  if (session.status === 'closed') clearResults(doc, session.id);
                }
              }),
            scrollToElement: (elementId) => {
              const target = api.getSceneElements().find((element) => element.id === elementId);
              if (!target) return Promise.reject(new Error('That element is not on the board.'));
              api.scrollToContent(target, { fitToViewport: false, animate: true });
              return Promise.resolve();
            },
          });
        }}
        onPointerUpdate={(update) => presenceRef.current?.pointerMoved(update)}
        onChange={(elements, appState, files) => {
          bindingRef.current?.onLocalChange(elements, files);
          presenceRef.current?.selectionChanged(appState.selectedElementIds);
          setActiveTool(appState.activeTool.type);
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
      <Toolbar
        activeTool={activeTool}
        onSelect={(tool: ToolbarTool) => apiRef.current?.setActiveTool({ type: tool })}
        onAddSticky={addSticky}
        stickyColor={stickyColor}
        theme={activeTheme}
        onHistory={onHistory}
        onConnect={canConnect && !readOnly ? connectSelection : undefined}
        onZoom={onZoom}
        zoomPercent={zoomPercent}
        menuItems={menuItems}
        readOnly={readOnly}
        imagesEnabled={imagesEnabled}
      />
    </div>
  );
}
