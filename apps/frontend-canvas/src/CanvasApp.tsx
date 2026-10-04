import { useEffect, useRef, useState } from 'react';
import { Toolbar, type ToolbarTool } from './Toolbar';
import { ELEMENT_DEFAULTS, VIEW_BACKGROUND_COLOR } from './element-style';
import { createStickyNote, type StickyColor } from './sticky-note';
import { useResolvedTheme, type CanvasTheme } from './useResolvedTheme';
import { CaptureUpdateAction, Excalidraw } from '@excalidraw/excalidraw';
import '@excalidraw/excalidraw/index.css';
import './styles/tokens.css';
import './styles/excalidraw-theme.css';
import './styles/toolbar.css';
import type { ExcalidrawImperativeAPI, ToolType } from '@excalidraw/excalidraw/types';
import * as Y from 'yjs';
import { ExcalidrawYjsBinding } from './yjs/excalidraw-binding.js';
import { YjsWebsocketClient } from './yjs/YjsWebsocketClient.js';

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
}

function defaultYjsServerUrl(): string {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}/yjs`;
}

export function CanvasApp({ boardId = 'default', yjsServerUrl, theme }: CanvasAppProps) {
  const resolvedTheme = useResolvedTheme(theme);
  const apiRef = useRef<ExcalidrawImperativeAPI | null>(null);
  const bindingRef = useRef<ExcalidrawYjsBinding | null>(null);
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
    const client = new YjsWebsocketClient(url.toString(), doc);

    return () => {
      client.destroy();
      binding.destroy();
      bindingRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
      data-theme={resolvedTheme}
      style={{ position: 'fixed', inset: 0 }}
    >
      <Excalidraw
        theme={resolvedTheme}
        initialData={{
          appState: { ...ELEMENT_DEFAULTS, viewBackgroundColor: VIEW_BACKGROUND_COLOR },
        }}
        excalidrawAPI={(api) => {
          apiRef.current = api;
          bindingRef.current?.attach(api);
        }}
        onChange={(elements, appState) => {
          bindingRef.current?.onLocalChange(elements);
          setActiveTool(appState.activeTool.type);
        }}
      />
      <Toolbar
        activeTool={activeTool}
        onSelect={(tool: ToolbarTool) => apiRef.current?.setActiveTool({ type: tool })}
        onAddSticky={addSticky}
      />
    </div>
  );
}
