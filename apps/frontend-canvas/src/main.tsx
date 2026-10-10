import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { CanvasApp } from './CanvasApp';
import { parseLocale } from './i18n';
import { parseTheme } from './useResolvedTheme';

const container = document.getElementById('root');
if (!container) {
  throw new Error('Missing #root element');
}

// Dev-only knobs: ?theme=light|dark, ?board=<id>, ?yjs=ws://localhost:3001/yjs (the realtime gateway), ?token=<ws token>
// (the gateway needs one: get it from `POST /api/realtime/token`; it lives for about a minute, so only the first
// connection of this page works, a reload needs a new one).
const params = new URLSearchParams(location.search);
const token = params.get('token');

createRoot(container).render(
  <StrictMode>
    <CanvasApp
      boardId={params.get('board') ?? 'dev'}
      yjsServerUrl={params.get('yjs') ?? undefined}
      theme={parseTheme(params.get('theme'))}
      locale={parseLocale(params.get('locale'))}
      tokenProvider={token ? async () => token : undefined}
    />
  </StrictMode>,
);
