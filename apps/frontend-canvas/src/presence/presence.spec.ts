import type { ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as awarenessProtocol from 'y-protocols/awareness';
import * as Y from 'yjs';
import { identityFor } from './identity';
import { POINTER_INTERVAL_MS, PresenceSync } from './presence';

/** Two awareness instances that see each other, as two clients of one board do through the server. */
function pair() {
  const a = new awarenessProtocol.Awareness(new Y.Doc());
  const b = new awarenessProtocol.Awareness(new Y.Doc());
  const relay = (from: awarenessProtocol.Awareness, to: awarenessProtocol.Awareness) =>
    from.on('update', ({ added, updated, removed }: Record<string, number[]>, origin: unknown) => {
      if (origin === 'relay') return;
      const ids = [...added, ...updated, ...removed];
      awarenessProtocol.applyAwarenessUpdate(
        to,
        awarenessProtocol.encodeAwarenessUpdate(from, ids),
        'relay',
      );
    });
  relay(a, b);
  relay(b, a);
  return { a, b };
}

/** Starts presence for a client whose instance the test does not need again. */
const join = (...args: ConstructorParameters<typeof PresenceSync>) => new PresenceSync(...args);

function fakeApi() {
  const updateScene = vi.fn();
  return { api: { updateScene } as unknown as ExcalidrawImperativeAPI, updateScene };
}

const collaboratorsOf = (updateScene: ReturnType<typeof vi.fn>) =>
  updateScene.mock.calls.at(-1)?.[0].collaborators as Map<string, { username: string }>;

describe('PresenceSync', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('announces who this client is', () => {
    const { a } = pair();
    const identity = identityFor('me');

    join(a, identity, () => null);

    expect(a.getLocalState()).toEqual({ user: identity });
  });

  it('puts another client on the canvas when it appears, and takes it off when it goes', () => {
    const { a, b } = pair();
    const { api, updateScene } = fakeApi();
    join(b, identityFor('me'), () => api);

    join(a, identityFor('ada'), () => null);

    expect([...collaboratorsOf(updateScene).values()].map((c) => c.username)).toEqual([
      identityFor('ada').name,
    ]);
    awarenessProtocol.removeAwarenessStates(a, [a.clientID], 'test');
    expect(collaboratorsOf(updateScene).size).toBe(0);
  });

  it('does not touch the scene history when it draws collaborators', () => {
    const { a, b } = pair();
    const { api, updateScene } = fakeApi();
    join(b, identityFor('me'), () => api);
    join(a, identityFor('ada'), () => null);

    expect(updateScene.mock.calls.at(-1)?.[0].captureUpdate).toBe('NEVER');
  });

  it('does not redraw the canvas for changes of its own state', () => {
    const { b } = pair();
    const { api, updateScene } = fakeApi();
    const presence = new PresenceSync(b, identityFor('me'), () => api);
    updateScene.mockClear();

    presence.pointerMoved({ pointer: { x: 1, y: 2, tool: 'pointer' }, button: 'up' });
    presence.selectionChanged({ x: true });

    expect(updateScene).not.toHaveBeenCalled();
  });

  it('refresh draws the clients that were there before the canvas was', () => {
    const { a, b } = pair();
    let api: ExcalidrawImperativeAPI | null = null;
    const presence = new PresenceSync(b, identityFor('me'), () => api);
    join(a, identityFor('ada'), () => null);
    const late = fakeApi();
    api = late.api;

    presence.refresh();

    expect(collaboratorsOf(late.updateScene).size).toBe(1);
  });

  it('does nothing without a canvas and nothing after it was destroyed', () => {
    const { a, b } = pair();
    const { api, updateScene } = fakeApi();
    const presence = new PresenceSync(b, identityFor('me'), () => null);
    presence.refresh(); // no canvas yet: no error

    const live = new PresenceSync(b, identityFor('me'), () => api);
    live.destroy();
    join(a, identityFor('ada'), () => null);

    expect(updateScene).not.toHaveBeenCalled();
  });

  describe('publishing', () => {
    it('sends the pointer to the others, throttled, with the last position kept', () => {
      const { a, b } = pair();
      const presence = new PresenceSync(a, identityFor('ada'), () => null);
      const seenByB = () =>
        (b.getStates().get(a.clientID) as { pointer?: { x: number } } | undefined)?.pointer?.x;

      presence.pointerMoved({ pointer: { x: 1, y: 0, tool: 'pointer' }, button: 'up' });
      presence.pointerMoved({ pointer: { x: 2, y: 0, tool: 'pointer' }, button: 'up' });
      presence.pointerMoved({ pointer: { x: 3, y: 0, tool: 'pointer' }, button: 'down' });
      expect(seenByB()).toBe(1);
      vi.advanceTimersByTime(POINTER_INTERVAL_MS);

      expect(seenByB()).toBe(3);
      expect(b.getStates().get(a.clientID)).toMatchObject({ button: 'down' });
    });

    it('sends the selection only when it changed', () => {
      const { a } = pair();
      const presence = new PresenceSync(a, identityFor('ada'), () => null);
      const updates = vi.fn();
      a.on('update', updates);

      presence.selectionChanged({ r1: true });
      presence.selectionChanged({ r1: true });
      presence.selectionChanged({ r1: true, r2: false });
      expect(updates).toHaveBeenCalledTimes(1);
      presence.selectionChanged({ r1: true, r2: true });
      presence.selectionChanged({});

      expect(updates).toHaveBeenCalledTimes(3);
      expect((a.getLocalState() as { selectedElementIds: object }).selectedElementIds).toEqual({});
    });

    it('stops publishing after it was destroyed, also a pointer that was still waiting', () => {
      const { a } = pair();
      const presence = new PresenceSync(a, identityFor('ada'), () => null);
      presence.pointerMoved({ pointer: { x: 1, y: 0, tool: 'pointer' }, button: 'up' });
      presence.pointerMoved({ pointer: { x: 2, y: 0, tool: 'pointer' }, button: 'up' });

      presence.destroy();
      vi.advanceTimersByTime(500);

      expect((a.getLocalState() as { pointer: { x: number } }).pointer.x).toBe(1);
    });
  });
});
