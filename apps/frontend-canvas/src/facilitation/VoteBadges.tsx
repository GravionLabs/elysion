import { useEffect, useRef, useSyncExternalStore } from 'react';
import type { ExcalidrawElement } from '@excalidraw/excalidraw/element/types';
import type { ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types';
import { connectableAt, toScene, toScreen, type View } from '../connection-points';
import type { ScenePoint } from '../connector';
import type { SceneStore } from '../scene-store';
import type { VotingSnapshot } from './voting-sync';

/** A press that moves no further than this (screen pixels) before it is released is a click, not a drag. */
export const CLICK_TOLERANCE = 4;

/** The dots of one element are this many pixels apart, and at most this many are drawn (the rest as "+n"). */
const DOT_SPACING = 13;
const MAX_DOTS = 5;

export interface VoteBadgesProps {
  apiRef: { readonly current: ExcalidrawImperativeAPI | null };
  /** The canvas root: pointer positions are relative to it, and clicks are listened for on it. */
  rootRef: { readonly current: HTMLElement | null };
  /** Tells that the scene, the selection or the view changed. */
  store: SceneStore;
  voting: VotingSnapshot;
  /** A viewer sees the badges and the result, but cannot vote. */
  readOnly: boolean;
  /** The person clicked an element (or a dot of their own, `onRetract`) while a voting was open. */
  onVote: (elementId: string) => void;
  onRetract: (elementId: string) => void;
}

function currentView(api: ExcalidrawImperativeAPI): View {
  const { scrollX, scrollY, zoom } = api.getAppState();
  return { scrollX, scrollY, zoom: zoom.value };
}

/** The top-right corner of an element, in scene coordinates, turned with the element. */
export function topRightCorner(element: ExcalidrawElement): ScenePoint {
  const cx = element.x + element.width / 2;
  const cy = element.y + element.height / 2;
  const dx = element.width / 2;
  const dy = -element.height / 2;
  const cos = Math.cos(element.angle);
  const sin = Math.sin(element.angle);
  return { x: cx + dx * cos - dy * sin, y: cy + dx * sin + dy * cos };
}

/** How the person is told what is left: the hint under the votes. */
export function hintText(left: number, total: number): string {
  return left > 0
    ? `Voting: ${left} of ${total} votes left (click an element to vote)`
    : `Voting: no votes left (click one of your dots to take it back)`;
}

/**
 * Dot voting on the canvas (docs/specs/frontend.md, "Facilitation: voting"). While a session is open, each element
 * shows the person's **own** votes as small dots at its top-right corner (nobody else's), a click on an element in the
 * selection tool, without a drag, casts a vote, and a click on one of the dots takes one back. Once the session is
 * closed, every element with votes shows a count. A layer of our own over the canvas, like the connection points: it
 * lets every pointer event through except those on the dots, and is no part of the scene (not synced, not exported).
 */
export function VoteBadges({
  apiRef,
  rootRef,
  store,
  voting,
  readOnly,
  onVote,
  onRetract,
}: VoteBadgesProps) {
  // Re-render whenever Excalidraw reports a change of the scene, the selection or the view.
  useSyncExternalStore(store.subscribe, store.get);
  // The listeners below are added once; they read the latest of these.
  const latest = useRef({ voting, readOnly, onVote });
  latest.current = { voting, readOnly, onVote };

  // The vote mode: a click (a press and a release at nearly the same place) on an element casts a vote.
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    let down: { x: number; y: number } | null = null;
    const onDown = (event: PointerEvent) => {
      down =
        event.button === 0 && event.target instanceof HTMLCanvasElement
          ? { x: event.clientX, y: event.clientY }
          : null;
    };
    const onUp = (event: PointerEvent) => {
      const pressed = down;
      down = null;
      const { voting: state, readOnly: viewer } = latest.current;
      const api = apiRef.current;
      if (!pressed || !api || viewer || state.openSessionId === null) return;
      if (event.button !== 0 || !(event.target instanceof HTMLCanvasElement)) return;
      if (Math.hypot(event.clientX - pressed.x, event.clientY - pressed.y) > CLICK_TOLERANCE)
        return;
      const appState = api.getAppState();
      // Drawing, editing text and moving things keep working: only a click with the selection tool votes.
      if (appState.activeTool.type !== 'selection' || appState.editingTextElement) return;
      const box = root.getBoundingClientRect();
      const view = currentView(api);
      const point = toScene({ x: event.clientX - box.left, y: event.clientY - box.top }, view);
      const target = connectableAt(api.getSceneElements(), point, view.zoom);
      if (target) latest.current.onVote(target.id);
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
  const session = voting.view;
  if (!api || !session) return null;
  const view = currentView(api);
  const elements = api.getSceneElements();
  const byId = new Map(elements.map((element) => [element.id, element]));
  const open = session.status === 'open' && voting.openSessionId === session.id;

  const corner = (element: ExcalidrawElement) => toScreen(topRightCorner(element), view);

  const dots = open
    ? Object.entries(voting.own).flatMap(([elementId, count]) => {
        const element = byId.get(elementId);
        return element && count > 0 ? [{ element, count }] : [];
      })
    : [];
  const counts = !open
    ? (session.tally ?? []).flatMap((entry) => {
        const element = byId.get(entry.elementId);
        return element ? [{ element, count: entry.count }] : [];
      })
    : [];
  const left = Math.max(0, session.votesPerPerson - session.myVotes);

  return (
    <>
      <div className="elysion-vote-badges" aria-hidden="true">
        {dots.map(({ element, count }) => {
          const at = corner(element);
          const shown = Math.min(count, MAX_DOTS);
          return (
            <div
              key={element.id}
              className="elysion-vote-dots"
              data-vote-dots={element.id}
              style={{ left: at.x, top: at.y }}
            >
              {Array.from({ length: shown }, (_, index) => (
                <button
                  key={index}
                  type="button"
                  tabIndex={-1}
                  className="elysion-vote-dot"
                  data-vote-dot={element.id}
                  disabled={readOnly}
                  style={{ right: index * DOT_SPACING }}
                  onClick={() => onRetract(element.id)}
                />
              ))}
              {count > MAX_DOTS && (
                <span className="elysion-vote-more" style={{ right: MAX_DOTS * DOT_SPACING }}>
                  +{count - MAX_DOTS}
                </span>
              )}
            </div>
          );
        })}
        {counts.map(({ element, count }) => {
          const at = corner(element);
          return (
            <div
              key={element.id}
              className="elysion-vote-count"
              data-vote-count={element.id}
              style={{ left: at.x, top: at.y }}
            >
              {count}
            </div>
          );
        })}
      </div>
      {open && !readOnly && (
        <div className="elysion-vote-hint" role="status">
          {hintText(left, session.votesPerPerson)}
        </div>
      )}
    </>
  );
}
