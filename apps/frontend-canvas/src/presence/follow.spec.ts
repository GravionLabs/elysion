import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as awarenessProtocol from 'y-protocols/awareness';
import * as Y from 'yjs';
import {
  readPresenter,
  startPresenting,
  stopPresenting,
  summonEveryone,
} from '../facilitation/presenter';
import {
  FollowController,
  NOT_FOLLOWING,
  STALE_PRESENTER_DELAY_MS,
  type FollowApi,
  type FollowState,
} from './follow';
import { identityFor } from './identity';
import { fitViewport, type Viewport } from './viewport';

const WINDOW = { width: 800, height: 600 };
const ADA = { ...identityFor('ada'), id: 'ada', name: 'Ada', color: '#14b8a6' };
const BEA = { ...identityFor('bea'), id: 'bea', name: 'Bea', color: '#3b82f6' };
const ME = { ...identityFor('me'), id: 'me', name: 'Me' };

const view = (x: number, width = 400, height = 300): Viewport => ({ x, y: 0, width, height });

/** The awareness of one tab of somebody else, as the server relays it to this client. */
function remoteTab(local: awarenessProtocol.Awareness, user: typeof ADA, viewport?: Viewport) {
  const remote = new awarenessProtocol.Awareness(new Y.Doc());
  const send = () =>
    awarenessProtocol.applyAwarenessUpdate(
      local,
      awarenessProtocol.encodeAwarenessUpdate(remote, [remote.clientID]),
      'relay',
    );
  remote.setLocalState({ user, ...(viewport ? { viewport } : {}) });
  send();
  return {
    move(next: Viewport) {
      remote.setLocalStateField('viewport', next);
      send();
    },
    leave() {
      awarenessProtocol.removeAwarenessStates(remote, [remote.clientID], 'test');
      send();
    },
  };
}

function setup({ canWrite = true } = {}) {
  const doc = new Y.Doc();
  const awareness = new awarenessProtocol.Awareness(new Y.Doc());
  awareness.setLocalState({ user: ME });
  const updateScene = vi.fn();
  const api: FollowApi = {
    getAppState: () => ({ ...WINDOW, scrollX: 0, scrollY: 0, zoom: { value: 1 } }),
    updateScene,
  };
  const states: FollowState[] = [];
  const controller = new FollowController({
    awareness,
    doc,
    api: () => api,
    me: () => ME.id,
    canWrite: () => canWrite,
    onChange: (state) => states.push(state),
  });
  const shown = () => {
    const { scrollX, scrollY, zoom } = updateScene.mock.lastCall![0].appState;
    return { scrollX, scrollY, zoom: zoom.value };
  };
  return { doc, awareness, controller, updateScene, states, shown };
}

const fit = (viewport: Viewport) => fitViewport(viewport, WINDOW);

describe('FollowController: following a person', () => {
  it('fits their viewport into this window and keeps doing so while they pan and zoom', () => {
    const { awareness, controller, shown, states } = setup();
    const ada = remoteTab(awareness, ADA, view(0));

    expect(controller.follow('ada')).toBe(true);
    expect(shown()).toEqual(fit(view(0)));
    ada.move(view(500, 800, 600));

    expect(shown()).toEqual(fit(view(500, 800, 600)));
    expect(states.at(-1)).toEqual({
      following: { id: 'ada', name: 'Ada', color: '#14b8a6', reason: 'person' },
      presenter: null,
      steppedOut: false,
    });
  });

  it('refuses a person who is not here, who has not shown a viewport, or this person themself', () => {
    const { awareness, controller, updateScene } = setup();
    remoteTab(awareness, BEA); // present, but no viewport yet

    expect(controller.follow('nobody')).toBe(false);
    expect(controller.follow('bea')).toBe(false);
    expect(controller.follow('me')).toBe(false);
    expect(updateScene).not.toHaveBeenCalled();
    expect(controller.state).toEqual(NOT_FOLLOWING);
  });

  it('follows the tab whose viewport changed last', () => {
    const { awareness, controller, shown } = setup();
    const first = remoteTab(awareness, ADA, view(0));
    const second = remoteTab(awareness, ADA, view(1000));

    controller.follow('ada');
    expect(shown()).toEqual(fit(view(1000)));

    first.move(view(50));
    expect(shown()).toEqual(fit(view(50)));

    second.move(view(2000));
    expect(shown()).toEqual(fit(view(2000)));
  });

  it('stops when the person pans or zooms, but not for the view it applied itself', () => {
    const { awareness, controller, states } = setup();
    remoteTab(awareness, ADA, view(0));
    controller.follow('ada');
    const applied = fit(view(0));

    controller.viewChanged(applied, WINDOW);
    expect(controller.state.following).not.toBeNull();

    controller.viewChanged({ ...applied, scrollX: applied.scrollX + 40 }, WINDOW);
    expect(controller.state.following).toBeNull();
    expect(states.at(-1)).toEqual(NOT_FOLLOWING);
  });

  it('fits again, instead of stopping, when the window changed size', () => {
    const { awareness, controller, updateScene } = setup();
    remoteTab(awareness, ADA, view(0));
    controller.follow('ada');
    updateScene.mockClear();

    controller.viewChanged({ scrollX: 3, scrollY: 4, zoom: 1.7 }, { width: 900, height: 600 });

    expect(controller.state.following).not.toBeNull();
    expect(updateScene).toHaveBeenCalledTimes(1);
  });

  it('stops with stop(), as Esc does, and does not move the canvas any more', () => {
    const { awareness, controller, updateScene } = setup();
    const ada = remoteTab(awareness, ADA, view(0));
    controller.follow('ada');
    controller.stop();
    updateScene.mockClear();

    ada.move(view(900));

    expect(controller.state.following).toBeNull();
    expect(updateScene).not.toHaveBeenCalled();
  });

  it('stops when the person leaves', () => {
    const { awareness, controller } = setup();
    const ada = remoteTab(awareness, ADA, view(0));
    controller.follow('ada');

    ada.leave();

    expect(controller.state.following).toBeNull();
  });

  it('keeps following while one of several tabs of the person is left', () => {
    const { awareness, controller } = setup();
    const first = remoteTab(awareness, ADA, view(0));
    remoteTab(awareness, ADA, view(10));
    controller.follow('ada');

    first.leave();

    expect(controller.state.following?.id).toBe('ada');
  });

  it('does not touch anything for the movement of somebody it does not follow', () => {
    const { awareness, controller, updateScene } = setup();
    remoteTab(awareness, ADA, view(0));
    const bea = remoteTab(awareness, BEA, view(0));
    controller.follow('ada');
    updateScene.mockClear();

    bea.move(view(300));

    expect(updateScene).not.toHaveBeenCalled();
  });
});

describe('FollowController: the presenter', () => {
  it('makes a client follow the presenter who is on the board', () => {
    const { awareness, doc, controller, shown } = setup();
    remoteTab(awareness, ADA, view(40));

    startPresenting(doc, 'ada', 1000);

    expect(shown()).toEqual(fit(view(40)));
    expect(controller.state).toEqual({
      following: { id: 'ada', name: 'Ada', color: '#14b8a6', reason: 'presenter' },
      presenter: { id: 'ada', name: 'Ada', color: '#14b8a6', me: false },
      steppedOut: false,
    });
  });

  it('ignores an entry whose person is not on the board, and follows once they are', () => {
    const { awareness, doc, controller, updateScene } = setup();

    startPresenting(doc, 'ada', 1000);
    expect(controller.state).toEqual(NOT_FOLLOWING);
    expect(updateScene).not.toHaveBeenCalled();

    remoteTab(awareness, ADA, view(5));
    expect(controller.state.following?.reason).toBe('presenter');
  });

  it('stops following when the presenter leaves, though the entry stays', () => {
    const { awareness, doc, controller } = setup();
    const ada = remoteTab(awareness, ADA, view(0));
    startPresenting(doc, 'ada', 1000);

    ada.leave();

    expect(controller.state).toEqual(NOT_FOLLOWING);
    expect(readPresenter(doc)).not.toBeNull();
  });

  it('lets anybody step out and back in, and a new presentation takes everybody along again', () => {
    const { awareness, doc, controller, updateScene } = setup();
    const ada = remoteTab(awareness, ADA, view(0));
    startPresenting(doc, 'ada', 1000);

    controller.stop();
    expect(controller.state.following).toBeNull();
    expect(controller.state.steppedOut).toBe(true);
    updateScene.mockClear();
    ada.move(view(700));
    expect(updateScene).not.toHaveBeenCalled();

    controller.followPresenter();
    expect(controller.state.following?.reason).toBe('presenter');
    expect(controller.state.steppedOut).toBe(false);

    controller.stop();
    startPresenting(doc, 'ada', 2000); // ended and started again
    expect(controller.state.following?.reason).toBe('presenter');
  });

  it('counts following somebody else as stepping out of the presentation', () => {
    const { awareness, doc, controller } = setup();
    remoteTab(awareness, ADA, view(0));
    remoteTab(awareness, BEA, view(900));
    startPresenting(doc, 'ada', 1000);

    controller.follow('bea');

    expect(controller.state.following).toMatchObject({ id: 'bea', reason: 'person' });
    expect(controller.state.steppedOut).toBe(true);
  });

  it('follows nobody when the presenter is this person, and says so', () => {
    const { doc, controller, updateScene } = setup();

    startPresenting(doc, 'me', 1000);

    expect(updateScene).not.toHaveBeenCalled();
    expect(controller.state.following).toBeNull();
    expect(controller.state.presenter).toMatchObject({ id: 'me', me: true });
  });

  it('is back to normal when the presentation ends', () => {
    const { awareness, doc, controller } = setup();
    remoteTab(awareness, ADA, view(0));
    startPresenting(doc, 'ada', 1000);

    stopPresenting(doc);

    expect(controller.state).toEqual(NOT_FOLLOWING);
  });

  it('ignores a malformed entry', () => {
    const { awareness, doc, controller } = setup();
    remoteTab(awareness, ADA, view(0));

    doc.getMap('session').set('presenter', { userId: 5, startedAt: 'x' });

    expect(controller.state).toEqual(NOT_FOLLOWING);
  });
});

describe('FollowController: a presentation that outlived its presenter', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('is deleted by a tab of the presenter that loads with no other tab of them present', () => {
    const { doc, controller } = setup();
    startPresenting(doc, 'me', 1000);

    controller.synced();
    expect(readPresenter(doc)).not.toBeNull();
    vi.advanceTimersByTime(STALE_PRESENTER_DELAY_MS);

    expect(readPresenter(doc)).toBeNull();
  });

  it('stays while another tab of the presenter is on the board', () => {
    const { awareness, doc, controller } = setup();
    remoteTab(awareness, { ...ME }, view(0));
    startPresenting(doc, 'me', 1000);

    controller.synced();
    vi.advanceTimersByTime(STALE_PRESENTER_DELAY_MS * 2);

    expect(readPresenter(doc)).toEqual({ userId: 'me', startedAt: 1000 });
  });

  it("does not touch somebody else's presentation, and a viewer writes nothing", () => {
    const other = setup();
    startPresenting(other.doc, 'ada', 1000);
    other.controller.synced();
    const viewer = setup({ canWrite: false });
    startPresenting(viewer.doc, 'me', 1000);
    viewer.controller.synced();

    vi.advanceTimersByTime(STALE_PRESENTER_DELAY_MS * 2);

    expect(readPresenter(other.doc)).not.toBeNull();
    expect(readPresenter(viewer.doc)).not.toBeNull();
  });

  it('does not run after destroy', () => {
    const { doc, controller } = setup();
    startPresenting(doc, 'me', 1000);
    controller.synced();

    controller.destroy();
    vi.advanceTimersByTime(STALE_PRESENTER_DELAY_MS * 2);

    expect(readPresenter(doc)).not.toBeNull();
  });
});

describe('FollowController: bring everyone to me', () => {
  it('jumps to the summoned viewport, without following anybody', () => {
    const { doc, controller, shown } = setup();
    controller.synced();

    summonEveryone(doc, 'ada', view(300), 5, 's1');

    expect(shown()).toEqual(fit(view(300)));
    expect(controller.state).toEqual(NOT_FOLLOWING);
  });

  it('does not act on a summon that was there when the board loaded, but on a later one', () => {
    const { doc, controller, updateScene } = setup();
    summonEveryone(doc, 'ada', view(300), 5, 's1');
    controller.synced();
    expect(updateScene).not.toHaveBeenCalled();

    summonEveryone(doc, 'ada', view(900), 6, 's1'); // same id: the same summon again
    expect(updateScene).not.toHaveBeenCalled();

    summonEveryone(doc, 'ada', view(900), 7, 's2');
    expect(updateScene).toHaveBeenCalledTimes(1);
  });

  it('does not act on anything before the board has loaded', () => {
    const { doc, updateScene } = setup();

    summonEveryone(doc, 'ada', view(300), 5, 's1');

    expect(updateScene).not.toHaveBeenCalled();
  });

  it('leaves the facilitator where they are, and ignores a malformed entry', () => {
    const { doc, controller, updateScene } = setup();
    controller.synced();

    summonEveryone(doc, 'me', view(300), 5, 's1');
    doc.getMap('session').set('summon', { id: 's2', userId: 'ada', viewport: { x: 1 }, at: 1 });

    expect(updateScene).not.toHaveBeenCalled();
  });

  it('does not make the jump look like panning to a client that follows somebody', () => {
    const { awareness, doc, controller } = setup();
    remoteTab(awareness, ADA, view(0));
    controller.follow('ada');
    controller.synced();

    summonEveryone(doc, 'bea', view(300), 5, 's1');
    controller.viewChanged(fit(view(300)), WINDOW);

    expect(controller.state.following?.id).toBe('ada');
  });
});
