import { useEffect, useReducer, useRef, useSyncExternalStore } from 'react';
import {
  computeLayout,
  minimapToScene,
  toMinimapRect,
  type MinimapLayout,
  type SceneSnapshot,
} from './minimap-geometry';
import type { SceneStore } from './scene-store';

export const MINIMAP_SIZE = { width: 160, height: 120 } as const;

export interface MinimapProps {
  store: SceneStore;
  /** Called with the scene point the user picked; the host scrolls it to the center of the canvas. */
  onPan: (center: { x: number; y: number }) => void;
}

function draw(canvas: HTMLCanvasElement, snapshot: SceneSnapshot, layout: MinimapLayout): void {
  const context = canvas.getContext('2d');
  if (!context) return;
  const dpr = window.devicePixelRatio || 1;
  canvas.width = MINIMAP_SIZE.width * dpr;
  canvas.height = MINIMAP_SIZE.height * dpr;
  context.setTransform(dpr, 0, 0, dpr, 0, 0);
  context.clearRect(0, 0, MINIMAP_SIZE.width, MINIMAP_SIZE.height);

  const css = getComputedStyle(canvas);
  const subtle = css.getPropertyValue('--c-text-subtle').trim() || '#6b7086';
  const primary = css.getPropertyValue('--c-primary').trim() || '#6366f1';
  const primarySoft = css.getPropertyValue('--c-primary-soft').trim() || 'rgba(99,102,241,0.08)';

  context.fillStyle = subtle;
  context.globalAlpha = 0.45;
  for (const element of snapshot.elements) {
    const rect = toMinimapRect(element, layout);
    context.fillRect(rect.x, rect.y, Math.max(rect.width, 2), Math.max(rect.height, 2));
  }

  context.globalAlpha = 1;
  const { viewport } = layout;
  context.fillStyle = primarySoft;
  context.fillRect(viewport.x, viewport.y, viewport.width, viewport.height);
  context.strokeStyle = primary;
  context.lineWidth = 1.5;
  context.strokeRect(viewport.x, viewport.y, viewport.width, viewport.height);
}

/** An overview of the whole scene with the visible area marked, like ariadne's minimap. */
export function Minimap({ store, onPan }: MinimapProps) {
  const snapshot = useSyncExternalStore(store.subscribe, store.get);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // While dragging, the mapping is frozen: the layout includes the viewport, so it would otherwise
  // rescale under the pointer whenever the view leaves the content.
  const frozenLayout = useRef<MinimapLayout | null>(null);
  // Bumped when the frozen layout is released, so the minimap re-fits even if no scene change follows.
  const [layoutVersion, refit] = useReducer((version: number) => version + 1, 0);
  const hasContent = !!snapshot && snapshot.elements.length > 0;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !snapshot || !hasContent) return;
    const frame = requestAnimationFrame(() =>
      draw(canvas, snapshot, frozenLayout.current ?? computeLayout(snapshot, MINIMAP_SIZE)),
    );
    return () => cancelAnimationFrame(frame);
  }, [snapshot, hasContent, layoutVersion]);

  if (!snapshot || !hasContent) return null;

  const panTo = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const layout = frozenLayout.current;
    if (!layout) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    // The pointer stays captured outside the minimap; clamp it so dragging out stops at the edge
    // instead of flying the view away from the content.
    const x = Math.min(Math.max(event.clientX - bounds.left, 0), MINIMAP_SIZE.width);
    const y = Math.min(Math.max(event.clientY - bounds.top, 0), MINIMAP_SIZE.height);
    onPan(minimapToScene({ x, y }, layout));
  };

  const release = () => {
    if (!frozenLayout.current) return;
    frozenLayout.current = null;
    refit();
  };

  return (
    <div className="elysion-minimap" role="group" aria-label="Canvas overview">
      <canvas
        ref={canvasRef}
        width={MINIMAP_SIZE.width}
        height={MINIMAP_SIZE.height}
        title="Overview: click or drag to move the view"
        onPointerDown={(event) => {
          frozenLayout.current = computeLayout(snapshot, MINIMAP_SIZE);
          event.currentTarget.setPointerCapture?.(event.pointerId);
          panTo(event);
        }}
        onPointerMove={(event) => {
          if (frozenLayout.current) panTo(event);
        }}
        onPointerUp={release}
        onPointerCancel={release}
      />
    </div>
  );
}
