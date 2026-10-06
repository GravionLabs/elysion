// THROWAWAY spike code (#513): not for merging.
import { useEffect, useRef, useState } from 'react';
import {
  CaptureUpdateAction,
  convertToExcalidrawElements,
  getCommonBounds,
} from '@excalidraw/excalidraw';
import type { ExcalidrawElement } from '@excalidraw/excalidraw/element/types';
import type { ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types';

type Side = 'top' | 'right' | 'bottom' | 'left';
const SIDES: Side[] = ['top', 'right', 'bottom', 'left'];
const CONNECTABLE = new Set(['rectangle', 'diamond', 'ellipse', 'image', 'frame', 'text']);
const RADIUS = 5; // screen px
const OFFSET = 8; // circles sit this far outside the border, screen px

const connectable = (e: ExcalidrawElement) =>
  !e.isDeleted &&
  CONNECTABLE.has(e.type) &&
  !(e.type === 'text' && (e as { containerId?: string | null }).containerId);

function point(e: ExcalidrawElement, side: Side, outset = 0) {
  const lx = side === 'left' ? -e.width / 2 - outset : side === 'right' ? e.width / 2 + outset : 0;
  const ly =
    side === 'top' ? -e.height / 2 - outset : side === 'bottom' ? e.height / 2 + outset : 0;
  const cos = Math.cos(e.angle);
  const sin = Math.sin(e.angle);
  const cx = e.x + e.width / 2;
  const cy = e.y + e.height / 2;
  return { x: cx + lx * cos - ly * sin, y: cy + lx * sin + ly * cos };
}

function contains(e: ExcalidrawElement, p: { x: number; y: number }, margin: number) {
  const cx = e.x + e.width / 2;
  const cy = e.y + e.height / 2;
  const dx = p.x - cx;
  const dy = p.y - cy;
  const cos = Math.cos(-e.angle);
  const sin = Math.sin(-e.angle);
  const lx = dx * cos - dy * sin;
  const ly = dx * sin + dy * cos;
  return Math.abs(lx) <= e.width / 2 + margin && Math.abs(ly) <= e.height / 2 + margin;
}

export function SpikeConnectors({
  apiRef,
  rootRef,
}: {
  apiRef: { current: ExcalidrawImperativeAPI | null };
  rootRef: { current: HTMLDivElement | null };
}) {
  const [, rerender] = useState(0);
  const hoverId = useRef<string | null>(null);
  const drag = useRef<null | { sourceId: string; side: Side; pointer: { x: number; y: number } }>(
    null,
  );
  const renders = useRef(0);
  renders.current += 1;
  (window as unknown as { __spikeRenders: () => number }).__spikeRenders = () => renders.current;

  // Scene follows: re-render on every change of scene or view (Excalidraw calls onChange; here a RAF poll keeps
  // the spike independent of CanvasApp's plumbing).
  useEffect(() => {
    let last = '';
    let raf = 0;
    const tick = () => {
      const api = apiRef.current;
      if (api) {
        const s = api.getAppState();
        const key = `${s.scrollX}|${s.scrollY}|${s.zoom.value}|${Object.keys(s.selectedElementIds).join()}|${api
          .getSceneElements()
          .map((e) => `${e.id}${e.version}`)
          .join()}`;
        if (key !== last) {
          last = key;
          rerender((n) => n + 1);
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [apiRef]);

  const toScene = (clientX: number, clientY: number) => {
    const api = apiRef.current!;
    const s = api.getAppState();
    const box = rootRef.current!.getBoundingClientRect();
    return {
      x: (clientX - box.left) / s.zoom.value - s.scrollX,
      y: (clientY - box.top) / s.zoom.value - s.scrollY,
    };
  };

  // Hover: a native listener on the root, independent of Excalidraw's callbacks.
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const onMove = (event: PointerEvent) => {
      const api = apiRef.current;
      if (!api || drag.current) return;
      const p = toScene(event.clientX, event.clientY);
      const zoom = api.getAppState().zoom.value;
      const margin = (OFFSET + RADIUS + 4) / zoom;
      const hit = [...api.getSceneElements()]
        .reverse()
        .find((e) => connectable(e) && contains(e, p, margin));
      const id = hit?.id ?? null;
      if (id !== hoverId.current) {
        hoverId.current = id;
        rerender((n) => n + 1);
      }
    };
    root.addEventListener('pointermove', onMove);
    return () => root.removeEventListener('pointermove', onMove);
  });

  const api = apiRef.current;
  if (!api) return null;
  const s = api.getAppState();
  const elements = api.getSceneElements();
  const shown = new Set<string>(
    Object.keys(s.selectedElementIds).filter((id) => s.selectedElementIds[id]),
  );
  if (hoverId.current) shown.add(hoverId.current);
  const toScreen = (p: { x: number; y: number }) => ({
    x: (p.x + s.scrollX) * s.zoom.value,
    y: (p.y + s.scrollY) * s.zoom.value,
  });
  const shapes = elements.filter((e) => connectable(e) && shown.has(e.id)).slice(0, 10);

  const onDown = (e: ExcalidrawElement, side: Side) => (event: React.PointerEvent) => {
    event.stopPropagation();
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    drag.current = { sourceId: e.id, side, pointer: toScene(event.clientX, event.clientY) };
    rerender((n) => n + 1);
  };
  const onMove = (event: React.PointerEvent) => {
    if (!drag.current) return;
    drag.current.pointer = toScene(event.clientX, event.clientY);
    rerender((n) => n + 1);
  };
  const onUp = (event: React.PointerEvent) => {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    const p = toScene(event.clientX, event.clientY);
    const all = api.getSceneElements();
    const source = all.find((x) => x.id === d.sourceId)!;
    const target = [...all]
      .reverse()
      .find((x) => x.id !== d.sourceId && connectable(x) && contains(x, p, 0));
    if (target) {
      // nearest side of the target
      const targetSide = SIDES.map((sd) => ({ sd, q: point(target, sd) })).sort(
        (a, b) => Math.hypot(a.q.x - p.x, a.q.y - p.y) - Math.hypot(b.q.x - p.x, b.q.y - p.y),
      )[0].sd;
      const from = point(source, d.side);
      const to = point(target, targetSide);
      const dx = to.x - from.x;
      const dy = to.y - from.y;
      const horizontal = (sd: Side) => sd === 'left' || sd === 'right';
      const route: [number, number][] =
        horizontal(d.side) && horizontal(targetSide)
          ? [
              [0, 0],
              [dx / 2, 0],
              [dx / 2, dy],
              [dx, dy],
            ]
          : !horizontal(d.side) && !horizontal(targetSide)
            ? [
                [0, 0],
                [0, dy / 2],
                [dx, dy / 2],
                [dx, dy],
              ]
            : horizontal(d.side)
              ? [
                  [0, 0],
                  [dx, 0],
                  [dx, dy],
                ]
              : [
                  [0, 0],
                  [0, dy],
                  [dx, dy],
                ];
      const out = convertToExcalidrawElements(
        [
          source,
          target,
          {
            type: 'arrow',
            x: from.x,
            y: from.y,
            width: Math.abs(dx),
            height: Math.abs(dy),
            points: route,
            elbowed: true,
            roughness: 0,
            strokeColor: '#1a1c23',
            endArrowhead: 'arrow',
            start: { id: source.id },
            end: { id: target.id },
          },
        ] as never,
        { regenerateIds: false },
      );
      const arrow = out[out.length - 1];
      const others = all.filter((x) => x.id !== source.id && x.id !== target.id);
      api.updateScene({
        elements: [...others, out[0], out[1], arrow],
        appState: { selectedElementIds: { [arrow.id]: true } },
        captureUpdate: CaptureUpdateAction.IMMEDIATELY,
      });
      (window as unknown as { __lastArrow: unknown }).__lastArrow = JSON.parse(
        JSON.stringify(arrow),
      );
    }
    rerender((n) => n + 1);
  };
  void getCommonBounds;

  const dragged = drag.current;
  const dragSource = dragged && elements.find((x) => x.id === dragged.sourceId);
  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        pointerEvents: 'none',
        overflow: 'hidden',
        zIndex: 5,
      }}
      data-testid="spike-overlay"
    >
      {shapes.flatMap((e) =>
        SIDES.map((side) => {
          const c = toScreen(point(e, side, OFFSET / s.zoom.value));
          return (
            <div
              key={`${e.id}-${side}`}
              data-spike-point={`${e.id}:${side}`}
              onPointerDown={onDown(e, side)}
              onPointerMove={onMove}
              onPointerUp={onUp}
              style={{
                position: 'absolute',
                left: c.x - RADIUS,
                top: c.y - RADIUS,
                width: RADIUS * 2,
                height: RADIUS * 2,
                borderRadius: '50%',
                background: '#fff',
                border: '1.5px solid #6366f1',
                pointerEvents: 'auto',
                cursor: 'crosshair',
                touchAction: 'none',
              }}
            />
          );
        }),
      )}
      {dragged && dragSource && (
        <svg style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}>
          {(() => {
            const a = toScreen(point(dragSource, dragged.side));
            const b = toScreen(dragged.pointer);
            return (
              <line
                x1={a.x}
                y1={a.y}
                x2={b.x}
                y2={b.y}
                stroke="#6366f1"
                strokeWidth={1.5}
                strokeDasharray="4 3"
              />
            );
          })()}
        </svg>
      )}
    </div>
  );
}
