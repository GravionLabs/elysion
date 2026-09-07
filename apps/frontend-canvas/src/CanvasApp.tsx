import { Tldraw } from 'tldraw';
import 'tldraw/tldraw.css';

export interface CanvasAppProps {
  boardId?: string;
}

export function CanvasApp({ boardId }: CanvasAppProps) {
  return (
    <div style={{ position: 'fixed', inset: 0 }}>
      <Tldraw persistenceKey={boardId} />
    </div>
  );
}
