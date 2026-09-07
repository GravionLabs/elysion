import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { CanvasApp } from './CanvasApp';

const container = document.getElementById('root');
if (!container) {
  throw new Error('Missing #root element');
}

createRoot(container).render(
  <StrictMode>
    <CanvasApp boardId="dev" />
  </StrictMode>,
);
