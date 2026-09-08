import { Excalidraw } from '@excalidraw/excalidraw';
import '@excalidraw/excalidraw/index.css';

export interface CanvasAppProps {
  /** Reserved for the Yjs-backed board persistence wired up in a later feature. */
  boardId?: string;
}

export function CanvasApp(props: CanvasAppProps) {
  return (
    <div style={{ position: 'fixed', inset: 0 }}>
      <Excalidraw />
    </div>
  );
}
