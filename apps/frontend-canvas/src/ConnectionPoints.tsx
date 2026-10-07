import { useEffect, useRef, useState, useSyncExternalStore, type PointerEvent } from 'react';
import type { ExcalidrawElement } from '@excalidraw/excalidraw/element/types';
import type { ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types';
import {
  POINT_DIAMETER,
  connectionPoints,
  containsPoint,
  hoveredShape,
  shapesWithPoints,
  toScene,
  toScreen,
  type View,
} from './connection-points';
import {
  MIN_DRAG_DISTANCE,
  dropSide,
  dropTarget,
  oppositeSide,
  screenDistance,
  stickyColorOf,
} from './connection-drop';
import { commitConnector } from './connector-commit';
import { createConnector, sidePoint, type ScenePoint, type Side } from './connector';
import { createStickyNote } from './sticky-note';
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
  /** Where the press started and where the pointer is now, in scene coordinates. */
  origin: ScenePoint;
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
    if (pointer) setDrag({ sourceId: shape.id, side, origin: pointer, pointer });
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
    // A click on a circle, or a drag that did not get anywhere, makes nothing.
    if (!source || screenDistance(dragging.origin, point, view.zoom) < MIN_DRAG_DISTANCE) return;

    // Released on the source itself: the user changed their mind.
    if (containsPoint(source, point)) return;

    const target = dropTarget(elements, source, point, view.zoom);
    // Released on empty canvas: a new sticky note there (the color of the source if that is a note), connected.
    const note = target ? null : createStickyNote(stickyColorOf(source), point);
    const end = target ?? note![0];
    const { arrow, updated } = createConnector([...elements, ...(note ?? [])], source.id, end.id, {
      sourceSide: dragging.side,
      targetSide: target
        ? dropSide(source, dragging.side, target, point, view.zoom)
        : oppositeSide(dragging.side),
    });
    commitConnector(
      api,
      { arrow, updated },
      { extra: note ?? [], select: note ? note[0].id : arrow.id },
    );
    if (note) editText(rootRef.current);
  };

  const dragSource = drag && elements.find((element) => element.id === drag.sourceId);
  // While dragging: the shape the connector would end on shows its circles, the one it would end at marked.
  const target =
    drag && dragSource ? dropTarget(elements, dragSource, drag.pointer, view.zoom) : undefined;
  const activeSide =
    drag && dragSource && target
      ? dropSide(dragSource, drag.side, target, drag.pointer, view.zoom)
      : undefined;
  const circles = new Map<string, { shape: ExcalidrawElement; side: Side; active: boolean }>();
  for (const shape of target ? [...shapes, target] : shapes) {
    for (const point of connectionPoints(shape, view.zoom)) {
      circles.set(`${shape.id}:${point.side}`, {
        shape,
        side: point.side,
        active: shape === target && point.side === activeSide,
      });
    }
  }

  const circleAt = (shape: ExcalidrawElement, side: Side) => {
    const point = connectionPoints(shape, view.zoom).find((candidate) => candidate.side === side)!;
    return toScreen(point, view);
  };

  return (
    <div className="elysion-connection-points" aria-hidden="true">
      {[...circles.entries()].map(([key, { shape, side, active }]) => {
        const at = circleAt(shape, side);
        const isTarget = shape === target;
        return (
          <div
            key={key}
            className="elysion-connection-point"
            data-connection-point={key}
            data-target={isTarget ? 'true' : undefined}
            data-active={active ? 'true' : undefined}
            style={{
              left: at.x - POINT_DIAMETER / 2,
              top: at.y - POINT_DIAMETER / 2,
              width: POINT_DIAMETER,
              height: POINT_DIAMETER,
            }}
            onPointerDown={start(shape, side)}
            onPointerMove={move}
            onPointerUp={finish}
            onPointerCancel={() => setDrag(null)}
          />
        );
      })}
      {drag && dragSource && (
        <svg className="elysion-connector-preview">
          {(() => {
            const from = toScreen(sidePoint(dragSource, drag.side), view);
            // The line ends on the circle it would snap to, otherwise at the pointer.
            const to =
              target && activeSide ? circleAt(target, activeSide) : toScreen(drag.pointer, view);
            return <line x1={from.x} y1={from.y} x2={to.x} y2={to.y} />;
          })()}
        </svg>
      )}
    </div>
  );
}

/**
 * Starts editing the text of the selected shape by pressing Enter on the canvas, which is what Excalidraw does for
 * the keyboard (it has no method for it). A frame later, so that the scene update has been taken in.
 */
function editText(root: HTMLElement | null): void {
  requestAnimationFrame(() => {
    const canvas = root?.querySelector<HTMLElement>('.excalidraw');
    if (!canvas) return;
    canvas.focus({ preventScroll: true });
    canvas.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'Enter',
        code: 'Enter',
        bubbles: true,
        cancelable: true,
      }),
    );
  });
}
