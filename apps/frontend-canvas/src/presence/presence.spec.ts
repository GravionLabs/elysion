import type { ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as awarenessProtocol from 'y-protocols/awareness';
import * as Y from 'yjs';
import { identityFor } from './identity';
import { POINTER_INTERVAL_MS, PRESENT_DEBOUNCE_MS, PresenceSync } from './presence';

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
  describe('telling the shell who is here', () => {
    const names = (users: { name: string }[]) => users.map((user) => user.name);

    it('says nothing at the start, when nobody else is here', () => {
      const { a } = pair();
      const onPresent = vi.fn();
      join(a, identityFor('me'), () => null, onPresent);

      vi.advanceTimersByTime(1000);

      expect(onPresent).not.toHaveBeenCalled();
    });

    it('reports somebody who joins, once things have settled, and again when they leave', () => {
      const { a, b } = pair();
      const onPresent = vi.fn();
      join(b, identityFor('me'), () => null, onPresent);

      join(a, identityFor('ada'), () => null);
      expect(onPresent).not.toHaveBeenCalled();
      vi.advanceTimersByTime(PRESENT_DEBOUNCE_MS);
      expect(names(onPresent.mock.calls[0][0])).toEqual([identityFor('ada').name]);

      awarenessProtocol.removeAwarenessStates(a, [a.clientID], 'test');
      vi.advanceTimersByTime(PRESENT_DEBOUNCE_MS);
      expect(onPresent).toHaveBeenLastCalledWith([]);
    });

    it('folds several people joining at once into one report', () => {
      const { a, b } = pair();
      const onPresent = vi.fn();
      join(b, identityFor('me'), () => null, onPresent);
      const c = new awarenessProtocol.Awareness(new Y.Doc());
      c.on('update', () =>
        awarenessProtocol.applyAwarenessUpdate(
          b,
          awarenessProtocol.encodeAwarenessUpdate(c, [c.clientID]),
          'relay',
        ),
      );

      join(a, identityFor('ada'), () => null);
      join(c, identityFor('bea'), () => null);
      vi.advanceTimersByTime(PRESENT_DEBOUNCE_MS);

      expect(onPresent).toHaveBeenCalledOnce();
      expect(onPresent.mock.calls[0][0]).toHaveLength(2);
    });

    it('does not report a moving pointer or a selection of somebody else', () => {
      const { a, b } = pair();
      const onPresent = vi.fn();
      join(b, identityFor('me'), () => null, onPresent);
      const ada = new PresenceSync(a, identityFor('ada'), () => null);
      vi.advanceTimersByTime(PRESENT_DEBOUNCE_MS);
      onPresent.mockClear();

      ada.pointerMoved({ pointer: { x: 5, y: 5, tool: 'pointer' }, button: 'up' });
      ada.selectionChanged({ r1: true });
      vi.advanceTimersByTime(1000);

      expect(onPresent).not.toHaveBeenCalled();
    });

    it('reports a new name of somebody else', () => {
      const { a, b } = pair();
      const onPresent = vi.fn();
      join(b, identityFor('me'), () => null, onPresent);
      const ada = new PresenceSync(a, identityFor('ada'), () => null);
      vi.advanceTimersByTime(PRESENT_DEBOUNCE_MS);

      ada.identityChanged({ ...identityFor('ada'), name: 'Ada L.' });
      vi.advanceTimersByTime(PRESENT_DEBOUNCE_MS);

      expect(names(onPresent.mock.calls.at(-1)![0])).toEqual(['Ada L.']);
    });

    it('does not report after it was destroyed', () => {
      const { a, b } = pair();
      const onPresent = vi.fn();
      const presence = new PresenceSync(b, identityFor('me'), () => null, onPresent);
      join(a, identityFor('ada'), () => null);

      presence.destroy();
      vi.advanceTimersByTime(1000);

      expect(onPresent).not.toHaveBeenCalled();
    });
  });

  it('publishes a new identity for the others', () => {
    const { a, b } = pair();
    const presence = new PresenceSync(a, identityFor('ada'), () => null);

    presence.identityChanged({ id: identityFor('ada').id, name: 'Ada', color: '#14b8a6' });

    expect(b.getStates().get(a.clientID)).toMatchObject({
      user: { name: 'Ada', color: '#14b8a6' },
    });
  });
});
