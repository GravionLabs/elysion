import { useEffect, useRef, useState, useSyncExternalStore, type PointerEvent } from 'react';
import { CaptureUpdateAction } from '@excalidraw/excalidraw';
import type { ExcalidrawElement } from '@excalidraw/excalidraw/element/types';
import type { ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types';
import {
  POINT_DIAMETER,
  connectableAt,
  connectionPoints,
  hoveredShape,
  nearestSide,
  shapesWithPoints,
  toScene,
  toScreen,
  type View,
} from './connection-points';
import { createConnector, sidePoint, type ScenePoint, type Side } from './connector';
import type { SceneStore } from './scene-store';

export interface ConnectionPointsProps {
  apiRef: { readonly current: ExcalidrawImperativeAPI | null };
  /** The canvas root: pointer positions are relative to it, and hovering is listened for on it. */
  rootRef: { readonly current: HTMLElement | null };
  /** Tells that the scene, the selection or the view changed. */
  store: SceneStore;
}

interface Drag {
  sourceId: string;
  side: Side;
  /** The pointer, in scene coordinates. */
  pointer: ScenePoint;
}

function currentView(api: ExcalidrawImperativeAPI): View {
  const { scrollX, scrollY, zoom } = api.getAppState();
  return { scrollX, scrollY, zoom: zoom.value };
}

/**
 * Connection points on shapes (docs/specs/frontend.md, "Connectors"): small circles at the middle of the four sides
 * of the hovered and the selected shapes. Pressing one and releasing over another shape connects the two with a
 * right-angled connector, in one undo step. A layer of our own over the canvas: it lets every pointer event through
 * except the ones on a circle, and is no part of the scene (it is not synced and not exported).
 */
export function ConnectionPoints({ apiRef, rootRef, store }: ConnectionPointsProps) {
  // Re-render whenever Excalidraw reports a change of the scene, the selection or the view.
  useSyncExternalStore(store.subscribe, store.get);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const dragRef = useRef<Drag | null>(null);
  dragRef.current = drag;

  /** A position of the pointer on the page as a point of the scene. */
  const sceneAt = (clientX: number, clientY: number): ScenePoint | null => {
    const api = apiRef.current;
    const root = rootRef.current;
    if (!api || !root) return null;
    const box = root.getBoundingClientRect();
    return toScene({ x: clientX - box.left, y: clientY - box.top }, currentView(api));
  };

  // Hovering: which shape is under the pointer. Excalidraw has no public callback for this.
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const onMove = (event: globalThis.PointerEvent) => {
      const api = apiRef.current;
      if (!api || dragRef.current) return;
      // A pressed button means a drag of something else (a shape, the view, a new shape): no points then.
      const point = event.buttons === 0 ? sceneAt(event.clientX, event.clientY) : null;
      const shape = point
        ? hoveredShape(api.getSceneElements(), point, currentView(api).zoom)
        : undefined;
      setHoveredId(shape?.id ?? null);
    };
    const onLeave = () => !dragRef.current && setHoveredId(null);
    root.addEventListener('pointermove', onMove);
    root.addEventListener('pointerleave', onLeave);
    return () => {
      root.removeEventListener('pointermove', onMove);
      root.removeEventListener('pointerleave', onLeave);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Escape cancels a connector that is being dragged.
  useEffect(() => {
    if (!drag) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setDrag(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [drag]);

  const api = apiRef.current;
  if (!api) return null;
  const state = api.getAppState();
  const busy =
    state.activeTool.type !== 'selection' ||
    state.selectedElementsAreBeingDragged ||
    state.resizingElement ||
    state.isRotating ||
    state.editingTextElement ||
    state.newElement;
  const view = currentView(api);
  const elements = api.getSceneElements();
  const shapes =
    busy && !drag ? [] : shapesWithPoints(elements, state.selectedElementIds, hoveredId);

  const start = (shape: ExcalidrawElement, side: Side) => (event: PointerEvent<HTMLElement>) => {
    event.stopPropagation(); // a press on a circle is not a press on the canvas
    event.currentTarget.setPointerCapture?.(event.pointerId);
    const pointer = sceneAt(event.clientX, event.clientY);
    if (pointer) setDrag({ sourceId: shape.id, side, pointer });
  };

  const move = (event: PointerEvent<HTMLElement>) => {
    const pointer = dragRef.current && sceneAt(event.clientX, event.clientY);
    if (pointer) setDrag({ ...dragRef.current!, pointer });
  };

  const finish = (event: PointerEvent<HTMLElement>) => {
    const dragging = dragRef.current;
    setDrag(null);
    setHoveredId(null); // the pointer is somewhere else now; the next move finds the shape under it
    const point = sceneAt(event.clientX, event.clientY);
    if (!dragging || !point) return;
    const source = elements.find((element) => element.id === dragging.sourceId);
    const target = connectableAt(elements, point, view.zoom, 0, dragging.sourceId);
    if (!source || !target) return;

    const { arrow, updated } = createConnector(elements, source.id, target.id, {
      sourceSide: dragging.side,
      // The side of the target nearest to where the connector leaves the source.
      targetSide: nearestSide(target, sidePoint(source, dragging.side)),
    });
    const replacement = new Map(updated.map((shape) => [shape.id, shape]));
    api.updateScene({
      // Including the deleted ones: removed elements are kept as tombstones for the sync.
      elements: [
        ...api
          .getSceneElementsIncludingDeleted()
          .map((element) => replacement.get(element.id) ?? element),
        arrow,
      ],
      appState: { selectedElementIds: { [arrow.id]: true } },
      captureUpdate: CaptureUpdateAction.IMMEDIATELY,
    });
  };

  const dragSource = drag && elements.find((element) => element.id === drag.sourceId);
  return (
    <div className="elysion-connection-points" aria-hidden="true">
      {shapes.flatMap((shape) =>
        connectionPoints(shape, view.zoom).map((point) => {
          const at = toScreen(point, view);
          return (
            <div
              key={`${shape.id}-${point.side}`}
              className="elysion-connection-point"
              data-connection-point={`${shape.id}:${point.side}`}
              style={{
                left: at.x - POINT_DIAMETER / 2,
                top: at.y - POINT_DIAMETER / 2,
                width: POINT_DIAMETER,
                height: POINT_DIAMETER,
              }}
              onPointerDown={start(shape, point.side)}
              onPointerMove={move}
              onPointerUp={finish}
              onPointerCancel={() => setDrag(null)}
            />
          );
        }),
      )}
      {drag && dragSource && (
        <svg className="elysion-connector-preview">
          {(() => {
            const from = toScreen(sidePoint(dragSource, drag.side), view);
            const to = toScreen(drag.pointer, view);
            return <line x1={from.x} y1={from.y} x2={to.x} y2={to.y} />;
          })()}
        </svg>
      )}
    </div>
  );
}
