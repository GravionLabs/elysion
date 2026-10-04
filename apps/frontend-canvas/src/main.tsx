import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { CanvasApp } from './CanvasApp';
import { parseTheme } from './useResolvedTheme';

const container = document.getElementById('root');
if (!container) {
  throw new Error('Missing #root element');
}

// Dev-only knobs: ?theme=light|dark, ?board=<id>, ?yjs=ws://localhost:3001/yjs (the realtime gateway).
const params = new URLSearchParams(location.search);

createRoot(container).render(
  <StrictMode>
    <CanvasApp
      boardId={params.get('board') ?? 'dev'}
      yjsServerUrl={params.get('yjs') ?? undefined}
      theme={parseTheme(params.get('theme'))}
    />
  </StrictMode>,
);
