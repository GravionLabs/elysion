import { useEffect, useRef, useSyncExternalStore } from 'react';
import type { ExcalidrawElement } from '@excalidraw/excalidraw/element/types';
import type { ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types';
import { connectableAt, toScene, toScreen, type View } from '../connection-points';
import type { ScenePoint } from '../connector';
import { useI18n } from '../i18n';
import type { SceneStore } from '../scene-store';
import type { CommentAnchor, CommentThread } from './comments';

/** A press that moves no further than this (screen pixels) before it is released is a click, not a drag. */
const CLICK_TOLERANCE = 4;
/** Markers on one element are this many pixels apart, so none hides another. */
const MARKER_SPACING = 26;

export interface CommentLayerProps {
  apiRef: { readonly current: ExcalidrawImperativeAPI | null };
  /** The canvas root: pointer positions are relative to it, and clicks are listened for on it. */
  rootRef: { readonly current: HTMLElement | null };
  store: SceneStore;
  threads: readonly CommentThread[];
  /** The comment tool is on: the next click on the canvas places a comment instead of doing what it normally does. */
  placing: boolean;
  /** The thread the panel shows, drawn out. */
  activeId: string | null;
  /** A comment is to be written at this place. */
  onPlace: (anchor: CommentAnchor) => void;
  /** A marker was clicked. */
  onOpen: (threadId: string) => void;
}

function currentView(api: ExcalidrawImperativeAPI): View {
  const { scrollX, scrollY, zoom } = api.getAppState();
  return { scrollX, scrollY, zoom: zoom.value };
}

/** The top-left corner of an element, in scene coordinates, turned with the element: where its markers hang. */
export function topLeftCorner(element: ExcalidrawElement): ScenePoint {
  const cx = element.x + element.width / 2;
  const cy = element.y + element.height / 2;
  const dx = -element.width / 2;
  const dy = -element.height / 2;
  const cos = Math.cos(element.angle);
  const sin = Math.sin(element.angle);
  return { x: cx + dx * cos - dy * sin, y: cy + dx * sin + dy * cos };
}

/**
 * The scene point a thread hangs on, or `null` when its element is gone (the thread stays in the panel, without a marker). A
 * point anchor stays where it is; an element anchor follows the element.
 */
export function anchorPoint(
  anchor: CommentAnchor,
  elements: ReadonlyMap<string, ExcalidrawElement>,
): ScenePoint | null {
  if ('elementId' in anchor) {
    const element = elements.get(anchor.elementId);
    return element && !element.isDeleted ? topLeftCorner(element) : null;
  }
  return anchor;
}

/**
 * Comments on the canvas: a marker with the count of messages for every thread, and, while the tool is on, the placing of a new
 * one. A layer of our own over the canvas like the connection points and the vote badges: it lets every pointer event
 * through except those on a marker, and is no part of the scene (not synced, not undoable, not in an export). While the
 * tool is on, the press on the canvas is taken before Excalidraw sees it, so it neither selects nor draws.
 */
export function CommentLayer({
  apiRef,
  rootRef,
  store,
  threads,
  placing,
  activeId,
  onPlace,
  onOpen,
}: CommentLayerProps) {
  const { t } = useI18n();
  useSyncExternalStore(store.subscribe, store.get);
  const latest = useRef({ placing, onPlace });
  latest.current = { placing, onPlace };

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    let down: { x: number; y: number } | null = null;
    const onDown = (event: PointerEvent) => {
      if (!latest.current.placing || event.button !== 0) return;
      if (!(event.target instanceof HTMLCanvasElement)) return;
      down = { x: event.clientX, y: event.clientY };
      event.stopPropagation();
    };
    const onUp = (event: PointerEvent) => {
      const pressed = down;
      down = null;
      const api = apiRef.current;
      if (!pressed || !api || !latest.current.placing) return;
      event.stopPropagation();
      if (Math.hypot(event.clientX - pressed.x, event.clientY - pressed.y) > CLICK_TOLERANCE)
        return;
      const box = root.getBoundingClientRect();
      const view = currentView(api);
      const point = toScene({ x: event.clientX - box.left, y: event.clientY - box.top }, view);
      const target = connectableAt(api.getSceneElements(), point, view.zoom);
      latest.current.onPlace(target ? { elementId: target.id } : { x: point.x, y: point.y });
    };
    root.addEventListener('pointerdown', onDown, true);
    root.addEventListener('pointerup', onUp, true);
    return () => {
      root.removeEventListener('pointerdown', onDown, true);
      root.removeEventListener('pointerup', onUp, true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const api = apiRef.current;
  if (!api || threads.length === 0) return null;
  const view = currentView(api);
  const elements = new Map(api.getSceneElements().map((element) => [element.id, element]));
  const taken = new Map<string, number>();

  const markers = threads.flatMap((thread) => {
    const point = anchorPoint(thread.anchor, elements);
    if (!point) return [];
    const key = `${Math.round(point.x)}:${Math.round(point.y)}`;
    const index = taken.get(key) ?? 0;
    taken.set(key, index + 1);
    const at = toScreen(point, view);
    return [{ thread, left: at.x + index * MARKER_SPACING, top: at.y }];
  });

  return (
    <div className="elysion-comment-markers">
      {markers.map(({ thread, left, top }) => (
        <button
          key={thread.id}
          type="button"
          className={[
            'elysion-comment-marker',
            thread.resolved ? 'resolved' : '',
            activeId === thread.id ? 'active' : '',
          ]
            .filter(Boolean)
            .join(' ')}
          data-comment-marker={thread.id}
          aria-label={t.commentMarker(thread.messages.length, thread.resolved)}
          title={t.commentMarker(thread.messages.length, thread.resolved)}
          style={{ left, top }}
          onClick={() => onOpen(thread.id)}
        >
          {thread.messages.length}
        </button>
      ))}
    </div>
  );
}
