import { useEffect, useRef } from 'react';
import { Excalidraw } from '@excalidraw/excalidraw';
import '@excalidraw/excalidraw/index.css';
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
}

function defaultYjsServerUrl(): string {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}/yjs`;
}

export function CanvasApp({ boardId = 'default', yjsServerUrl }: CanvasAppProps) {
  const bindingRef = useRef<ExcalidrawYjsBinding | null>(null);
  const clientRef = useRef<YjsWebsocketClient | null>(null);

  // Created once per mount, deliberately not re-run if boardId/yjsServerUrl
  // change later — matches how this component previously treated boardId
  // for tldraw's persistenceKey.
  if (!bindingRef.current) {
    const doc = new Y.Doc();
    bindingRef.current = new ExcalidrawYjsBinding(doc);

    const url = new URL(yjsServerUrl ?? defaultYjsServerUrl());
    url.searchParams.set('board', boardId);
    clientRef.current = new YjsWebsocketClient(url.toString(), doc);
  }

  useEffect(() => {
    return () => {
      clientRef.current?.destroy();
      clientRef.current = null;
      bindingRef.current?.destroy();
      bindingRef.current = null;
    };
  }, []);

  return (
    <div style={{ position: 'fixed', inset: 0 }}>
      <Excalidraw
        excalidrawAPI={(api) => bindingRef.current?.attach(api)}
        onChange={(elements) => bindingRef.current?.onLocalChange(elements)}
      />
    </div>
  );
}
