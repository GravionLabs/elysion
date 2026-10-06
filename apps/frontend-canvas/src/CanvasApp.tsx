import { useEffect, useRef, useState } from 'react';
import { exportBoard, importFile, type ExportFormat, type ExportOptions } from './board-io';
import { Minimap } from './Minimap';
import { SceneStore } from './scene-store';
import { scrollToCenter } from './minimap-geometry';
import { ZOOM_STEP, zoomAbout } from './zoom';
import { Toolbar, type HistoryAction, type ToolbarTool, type ZoomAction } from './Toolbar';
import { ELEMENT_DEFAULTS, VIEW_BACKGROUND_COLOR } from './element-style';
import { createStickyNote, type StickyColor } from './sticky-note';
import { useResolvedTheme, type CanvasTheme } from './useResolvedTheme';
import { CaptureUpdateAction, DefaultSidebar, Excalidraw, MainMenu } from '@excalidraw/excalidraw';
import '@excalidraw/excalidraw/index.css';
import '@elysion/design-tokens/tokens.css';
import './styles/excalidraw-theme.css';
import './styles/toolbar.css';
import type { ExcalidrawImperativeAPI, ToolType } from '@excalidraw/excalidraw/types';
import * as Y from 'yjs';
import { ExcalidrawYjsBinding } from './yjs/excalidraw-binding.js';
import { YjsWebsocketClient, type YjsConnectionStatus } from './yjs/YjsWebsocketClient.js';
import { createSessionIdentity, withHostIdentity } from './presence/identity';
import type { PresentUser } from './presence/collaborators';
import { PresenceSync } from './presence/presence';

/** What the host can ask the canvas to do; the element exposes these as methods. */
export interface CanvasControls {
  /** Opens Excalidraw's library sidebar, or closes it when it is open. */
  toggleLibrary(): void;
  /** The board (or the selection) as a file, or `null` when there is nothing to export. */
  exportBoard(format: ExportFormat, options?: ExportOptions): Promise<Blob | null>;
  /** Replaces the board with the contents of an .excalidraw file; resolves with its element count. */
  importFile(file: Blob): Promise<number>;
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
  /** The connection to the board server failed; the canvas keeps retrying, so this is news, not the end. */
  onError?: (error: Error) => void;
  /**
   * Asked before every connection to the board server (the first and each reconnect) for the token that goes on the
   * URL; see `YjsWebsocketClientOptions.tokenProvider` for what it may return. Without one, no token is sent.
   */
  tokenProvider?: () => Promise<string | null | undefined>;
  /**
   * A viewer: Excalidraw's view mode, no drawing tools in the toolbar, no import and no "clear canvas". The
   * realtime service refuses a viewer's changes anyway; this is what the viewer sees instead of tools that would
   * silently do nothing.
   */
  readOnly?: boolean;
  /** The name shown next to this user's cursor on other screens; a generated guest name when unset. */
  userName?: string;
  /** The color of this user's cursor, `#rrggbb`; one picked from the palette when unset or not valid. */
  userColor?: string;
}

function defaultYjsServerUrl(): string {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}/yjs`;
}

// Excalidraw only offers its own light/dark toggle when it is not given a `theme`; we always pass one
// (the host or the system decides), so the toggle has to be switched on explicitly.
const UI_OPTIONS = { canvasActions: { toggleTheme: true } };

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
  onError,
  tokenProvider,
  readOnly = false,
  userName,
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
  const errorCallback = useRef(onError);
  presenceCallback.current = onPresenceChange;
  errorCallback.current = onError;
  const tokenProviderRef = useRef(tokenProvider);
  tokenProviderRef.current = tokenProvider;
  const readOnlyRef = useRef(readOnly);
  readOnlyRef.current = readOnly;
  const apiRef = useRef<ExcalidrawImperativeAPI | null>(null);
  const bindingRef = useRef<ExcalidrawYjsBinding | null>(null);
  const presenceRef = useRef<PresenceSync | null>(null);
  // Who this tab is, made once: a re-render must not make a new collaborator.
  const identityRef = useRef(createSessionIdentity());
  const identity = withHostIdentity(identityRef.current, userName, userColor);
  const identityNow = useRef(identity);
  identityNow.current = identity;
  const sceneStoreRef = useRef(new SceneStore());
  const [activeTool, setActiveTool] = useState<ToolType | 'custom'>('selection');
  const [zoomPercent, setZoomPercent] = useState(100);
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
    const binding = new ExcalidrawYjsBinding(doc);
    bindingRef.current = binding;
    if (apiRef.current) {
      binding.attach(apiRef.current);
    }

    const url = new URL(yjsServerUrl ?? defaultYjsServerUrl());
    url.searchParams.set('board', boardId);
    const client = new YjsWebsocketClient(url.toString(), doc, {
      onStatusChange: (status) => statusCallback.current?.(status),
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

    return () => {
      presence.destroy();
      presenceRef.current = null;
      client.destroy();
      binding.destroy();
      bindingRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The host changed the name or color after the canvas started.
  useEffect(() => {
    presenceRef.current?.identityChanged(identityNow.current);
  }, [identity.name, identity.color]);

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

  const addSticky = (color: StickyColor) => {
    const api = apiRef.current;
    if (!api) return;
    const { scrollX, scrollY, zoom, width, height } = api.getAppState();
    const center = {
      x: width / 2 / zoom.value - scrollX,
      y: height / 2 / zoom.value - scrollY,
    };
    const note = createStickyNote(color, center);
    api.updateScene({
      elements: [...api.getSceneElements(), ...note],
      appState: { selectedElementIds: { [note[0].id]: true } },
      captureUpdate: CaptureUpdateAction.IMMEDIATELY,
    });
    api.setActiveTool({ type: 'selection' });
  };

  return (
    <div
      ref={rootRef}
      className="elysion-canvas"
      data-theme={activeTheme}
      style={{ position: 'absolute', inset: 0 }}
    >
      <Excalidraw
        theme={activeTheme}
        viewModeEnabled={readOnly}
        UIOptions={UI_OPTIONS}
        initialData={{
          appState: { ...ELEMENT_DEFAULTS, viewBackgroundColor: VIEW_BACKGROUND_COLOR },
        }}
        excalidrawAPI={(api) => {
          apiRef.current = api;
          bindingRef.current?.attach(api);
          presenceRef.current?.refresh(); // the collaborators that were there before the canvas was
          controlsCallback.current?.({
            toggleLibrary: () => api.toggleSidebar({ name: LIBRARY_SIDEBAR, tab: LIBRARY_TAB }),
            exportBoard: (format, options) => exportBoard(api, format, options),
            importFile: (file) =>
              readOnlyRef.current
                ? Promise.reject(new Error('This board is read-only.'))
                : importFile(api, file),
          });
        }}
        onPointerUpdate={(update) => presenceRef.current?.pointerMoved(update)}
        onChange={(elements, appState) => {
          bindingRef.current?.onLocalChange(elements);
          presenceRef.current?.selectionChanged(appState.selectedElementIds);
          setActiveTool(appState.activeTool.type);
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
        {/* Open, save, export and the theme are in the top bar; what is left is here. */}
        <MainMenu>
          {!readOnly && <MainMenu.DefaultItems.ClearCanvas />}
          <MainMenu.DefaultItems.Help />
        </MainMenu>
      </Excalidraw>
      <Minimap store={sceneStoreRef.current} onPan={panTo} />
      <Toolbar
        activeTool={activeTool}
        onSelect={(tool: ToolbarTool) => apiRef.current?.setActiveTool({ type: tool })}
        onAddSticky={addSticky}
        onHistory={onHistory}
        onZoom={onZoom}
        zoomPercent={zoomPercent}
        readOnly={readOnly}
      />
    </div>
  );
}
