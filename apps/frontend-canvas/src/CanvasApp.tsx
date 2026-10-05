import { useEffect, useRef, useState } from 'react';
import { Minimap } from './Minimap';
import { SceneStore } from './scene-store';
import { scrollToCenter } from './minimap-geometry';
import { Toolbar, type ToolbarTool } from './Toolbar';
import { ELEMENT_DEFAULTS, VIEW_BACKGROUND_COLOR } from './element-style';
import { createStickyNote, type StickyColor } from './sticky-note';
import { useResolvedTheme, type CanvasTheme } from './useResolvedTheme';
import { CaptureUpdateAction, DefaultSidebar, Excalidraw } from '@excalidraw/excalidraw';
import '@excalidraw/excalidraw/index.css';
import '@elysion/design-tokens/tokens.css';
import './styles/excalidraw-theme.css';
import './styles/toolbar.css';
import type { ExcalidrawImperativeAPI, ToolType } from '@excalidraw/excalidraw/types';
import * as Y from 'yjs';
import { ExcalidrawYjsBinding } from './yjs/excalidraw-binding.js';
import { YjsWebsocketClient, type YjsConnectionStatus } from './yjs/YjsWebsocketClient.js';

/** What the host can ask the canvas to do; the element exposes these as methods. */
export interface CanvasControls {
  /** Opens Excalidraw's library sidebar, or closes it when it is open. */
  toggleLibrary(): void;
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
  const apiRef = useRef<ExcalidrawImperativeAPI | null>(null);
  const bindingRef = useRef<ExcalidrawYjsBinding | null>(null);
  const sceneStoreRef = useRef(new SceneStore());
  const [activeTool, setActiveTool] = useState<ToolType | 'custom'>('selection');

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
    });

    return () => {
      client.destroy();
      binding.destroy();
      bindingRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const panTo = (center: { x: number; y: number }) => {
    const snapshot = sceneStoreRef.current.get();
    if (!snapshot) return;
    apiRef.current?.updateScene({
      appState: scrollToCenter(center, snapshot),
      captureUpdate: CaptureUpdateAction.NEVER,
    });
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
      className="elysion-canvas"
      data-theme={activeTheme}
      style={{ position: 'absolute', inset: 0 }}
    >
      <Excalidraw
        theme={activeTheme}
        UIOptions={UI_OPTIONS}
        initialData={{
          appState: { ...ELEMENT_DEFAULTS, viewBackgroundColor: VIEW_BACKGROUND_COLOR },
        }}
        excalidrawAPI={(api) => {
          apiRef.current = api;
          bindingRef.current?.attach(api);
          controlsCallback.current?.({
            toggleLibrary: () => api.toggleSidebar({ name: LIBRARY_SIDEBAR, tab: LIBRARY_TAB }),
          });
        }}
        onChange={(elements, appState) => {
          bindingRef.current?.onLocalChange(elements);
          setActiveTool(appState.activeTool.type);
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
      <Toolbar
        activeTool={activeTool}
        onSelect={(tool: ToolbarTool) => apiRef.current?.setActiveTool({ type: tool })}
        onAddSticky={addSticky}
      />
    </div>
  );
}
