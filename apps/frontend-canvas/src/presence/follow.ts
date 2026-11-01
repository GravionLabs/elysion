import type * as Y from 'yjs';
import type { Awareness } from 'y-protocols/awareness';
import { CaptureUpdateAction } from '@excalidraw/excalidraw';
import type { NormalizedZoomValue } from '@excalidraw/excalidraw/types';
import {
  observeKey,
  readPresenter,
  readSummon,
  stopPresenting,
  type PresenterState,
} from '../facilitation/presenter';
import { HEX_COLOR, IDENTITY_COLORS, MAX_NAME_LENGTH, type PresenceState } from './identity';
import {
  fitViewport,
  parseViewport,
  sameView,
  sameViewport,
  type ViewTransform,
  type Viewport,
} from './viewport';

/** A person on the board, as the follow state names them. */
export interface FollowPerson {
  id: string;
  name: string;
  color: string;
}

/** What the canvas draws and the shell is told (the `follow` event). */
export interface FollowState {
  /** Whom this client follows now, and why; `null` when nobody. */
  following: (FollowPerson & { reason: 'person' | 'presenter' }) | null;
  /** The person who presents, while they are on the board; `me` when it is this person. */
  presenter: (FollowPerson & { me: boolean }) | null;
  /** A presentation by somebody else is on, and this client left it (Esc, or followed another person). */
  steppedOut: boolean;
}

export const NOT_FOLLOWING: FollowState = { following: null, presenter: null, steppedOut: false };

/** How long a loaded tab of the presenter waits for the awareness before it takes a leftover presentation for stale. */
export const STALE_PRESENTER_DELAY_MS = 1500;

/** The pieces of Excalidraw's API the controller uses. */
export interface FollowApi {
  getAppState(): {
    width: number;
    height: number;
    scrollX: number;
    scrollY: number;
    zoom: { value: number };
  };
  updateScene(scene: {
    appState: { scrollX: number; scrollY: number; zoom: { value: NormalizedZoomValue } };
    captureUpdate: typeof CaptureUpdateAction.NEVER;
  }): void;
}

export interface FollowDeps {
  awareness: Awareness;
  doc: Y.Doc;
  api: () => FollowApi | null;
  /** The id of this person in the awareness (`user.id`). */
  me: () => string;
  /** Whether this client may write the document (a viewer may not delete a stale presentation). */
  canWrite: () => boolean;
  onChange: (state: FollowState) => void;
}

interface Client {
  clientId: number;
  person: FollowPerson;
  viewport: Viewport | null;
}

/**
 * Follows a person's view, or the presenter's, and obeys "bring everyone to me" (#848).
 *
 * The viewports come through the awareness, the presentation and the summon through the document (`presenter.ts`). A
 * person with several tabs is followed through the tab whose viewport changed last, judged by the order in which this
 * client saw the changes (no clock). The view is fitted into this client's own window (`fitViewport`) every time the
 * target moves; a change of the view that this controller did not make (panning, zooming) ends the following, like Esc.
 */
export class FollowController {
  readonly #deps: FollowDeps;
  readonly #seen = new Map<number, { viewport: string; order: number }>();
  readonly #watchers: Array<{ destroy(): void }>;
  #order = 0;
  #mode: { kind: 'person'; id: string } | { kind: 'presenter' } | null = null;
  /** The `startedAt` of the presentation this client stepped out of. */
  #steppedOutOf: number | null = null;
  #applied: { view: ViewTransform; size: { width: number; height: number } } | null = null;
  #appliedTarget: Viewport | null = null;
  #state: FollowState = NOT_FOLLOWING;
  #summonSeen: string | null | undefined; // undefined: not loaded yet, nothing is acted on
  #staleTimer: ReturnType<typeof setTimeout> | null = null;
  #destroyed = false;

  constructor(deps: FollowDeps) {
    this.#deps = deps;
    this.#remember();
    this.#watchers = [
      observeKey(
        deps.doc,
        () => readPresenter(deps.doc),
        () => this.refresh(),
      ),
      observeKey(
        deps.doc,
        () => readSummon(deps.doc),
        () => this.#onSummon(),
      ),
    ];
    deps.awareness.on('change', this.#onAwareness);
  }

  get state(): FollowState {
    return this.#state;
  }

  /**
   * Follows a person. `false` when they are not on the board (or have not shown a viewport yet, in which case nothing could
   * be shown). Follows over a presentation: the person then counts as having stepped out of it.
   */
  follow(personId: string): boolean {
    if (personId === this.#deps.me()) return false;
    if (!this.#clientsOf(personId).some((client) => client.viewport)) return false;
    const presenter = this.#livePresenter();
    if (presenter && !presenter.me) this.#steppedOutOf = presenter.entry.startedAt;
    this.#mode = { kind: 'person', id: personId };
    this.#appliedTarget = null;
    this.refresh();
    return this.#mode !== null;
  }

  /** Ends the following (Esc, or panning and zooming); out of a presentation, `followPresenter` goes back in. */
  stop(): void {
    if (!this.#mode) return;
    if (this.#mode.kind === 'presenter') {
      this.#steppedOutOf = readPresenter(this.#deps.doc)?.startedAt ?? null;
    }
    this.#mode = null;
    this.#appliedTarget = null;
    this.refresh();
  }

  /** Back into the presentation this client stepped out of. */
  followPresenter(): void {
    this.#steppedOutOf = null;
    this.#appliedTarget = null;
    if (this.#mode?.kind === 'person') this.#mode = null;
    this.refresh();
  }

  /**
   * The canvas changed (Excalidraw's `onChange`): a view that is not the one this controller applied means the person
   * panned or zoomed, so the following ends; a window that changed size is fitted again instead.
   */
  viewChanged(view: ViewTransform, size: { width: number; height: number }): void {
    if (!this.#mode || !this.#applied) return;
    if (sameView(view, this.#applied.view)) return;
    if (size.width !== this.#applied.size.width || size.height !== this.#applied.size.height) {
      this.#appliedTarget = null;
      this.refresh();
      return;
    }
    this.stop();
  }

  /**
   * The first sync of the board is done: the summon found now is the baseline (somebody who joins after a summon never
   * jumps), and a presentation of this person that no other tab of them keeps alive is a leftover and is removed.
   */
  synced(): void {
    if (this.#summonSeen === undefined) this.#summonSeen = readSummon(this.#deps.doc)?.id ?? null;
    if (this.#staleTimer === null) {
      this.#staleTimer = setTimeout(() => {
        this.#staleTimer = null;
        this.#dropStalePresentation();
      }, STALE_PRESENTER_DELAY_MS);
    }
    this.refresh();
  }

  /** Brings the state up to date with the awareness and the document, and shows the target's view when it moved. */
  refresh = (): void => {
    if (this.#destroyed) return;
    const live = this.#livePresenter();
    if (this.#steppedOutOf !== null && live?.entry.startedAt !== this.#steppedOutOf) {
      this.#steppedOutOf = null; // that presentation is over
    }
    if (this.#mode?.kind === 'presenter' && (!live || live.me)) this.#mode = null;
    if (!this.#mode && live && !live.me && this.#steppedOutOf !== live.entry.startedAt) {
      this.#mode = { kind: 'presenter' };
      this.#appliedTarget = null;
    }

    let following: FollowState['following'] = null;
    if (this.#mode) {
      const personId = this.#mode.kind === 'person' ? this.#mode.id : live!.entry.userId;
      const clients = this.#clientsOf(personId);
      if (clients.length === 0) {
        // The person left; the presentation stays in the document, but there is nobody to follow.
        this.#mode = null;
        this.#appliedTarget = null;
      } else {
        const latest = this.#latestChanged(clients);
        following = { ...latest.person, reason: this.#mode.kind };
        if (latest.viewport) this.#show(latest.viewport);
      }
    }

    const next: FollowState = {
      following,
      presenter: live ? { ...live.person, me: live.me } : null,
      steppedOut: !!live && !live.me && this.#steppedOutOf === live.entry.startedAt,
    };
    if (JSON.stringify(next) !== JSON.stringify(this.#state)) {
      this.#state = next;
      this.#deps.onChange(next);
    }
  };

  /** Fits the window to `target` once per movement of the target (and again when the window changed). */
  #show(target: Viewport): void {
    if (sameViewport(target, this.#appliedTarget ?? undefined)) return;
    if (this.#jump(target)) this.#appliedTarget = target;
  }

  /** Shows `target` in this window; `false` when there is no canvas yet. */
  #jump(target: Viewport): boolean {
    const api = this.#deps.api();
    if (!api) return false;
    const { width, height } = api.getAppState();
    if (!(width > 0 && height > 0)) return false;
    const view = fitViewport(target, { width, height });
    this.#applied = { view, size: { width, height } };
    api.updateScene({
      appState: {
        scrollX: view.scrollX,
        scrollY: view.scrollY,
        zoom: { value: view.zoom as NormalizedZoomValue },
      },
      captureUpdate: CaptureUpdateAction.NEVER,
    });
    return true;
  }

  #onSummon = (): void => {
    if (this.#summonSeen === undefined || this.#destroyed) return; // not loaded yet: that is the baseline's business
    const summon = readSummon(this.#deps.doc);
    if (!summon || summon.id === this.#summonSeen) return;
    this.#summonSeen = summon.id;
    if (summon.userId === this.#deps.me()) return; // the facilitator stays where they are
    this.#jump(summon.viewport);
  };

  #dropStalePresentation(): void {
    if (this.#destroyed || !this.#deps.canWrite()) return;
    const entry = readPresenter(this.#deps.doc);
    if (!entry || entry.userId !== this.#deps.me()) return;
    if (this.#clientsOf(entry.userId).length > 0) return; // another tab of the presenter is there: it goes on
    stopPresenting(this.#deps.doc);
  }

  /** The presenter, when the entry names somebody who is on the board (or this person). */
  #livePresenter(): { entry: PresenterState; person: FollowPerson; me: boolean } | null {
    const entry = readPresenter(this.#deps.doc);
    if (!entry) return null;
    if (entry.userId === this.#deps.me()) {
      const own = personOf(this.#deps.awareness.getLocalState());
      return {
        entry,
        person: own ?? { id: entry.userId, name: '', color: IDENTITY_COLORS[0] },
        me: true,
      };
    }
    const clients = this.#clientsOf(entry.userId);
    if (clients.length === 0) return null;
    return { entry, person: this.#latestChanged(clients).person, me: false };
  }

  /** The tabs of a person that are on the board (not this client's own). */
  #clientsOf(personId: string): Client[] {
    const clients: Client[] = [];
    for (const [clientId, raw] of this.#deps.awareness.getStates()) {
      if (clientId === this.#deps.awareness.clientID) continue;
      const state = raw as Partial<PresenceState> | null;
      const person = personOf(state);
      if (!person || person.id !== personId) continue;
      clients.push({ clientId, person, viewport: parseViewport(state?.viewport) });
    }
    return clients;
  }

  /** The tab whose viewport changed last as this client saw it; one that never showed a viewport comes last. */
  #latestChanged(clients: Client[]): Client {
    let best = clients[0];
    let bestOrder = -1;
    for (const client of clients) {
      const order = client.viewport ? (this.#seen.get(client.clientId)?.order ?? 0) : -1;
      if (order > bestOrder || (order === bestOrder && client.viewport && !best.viewport)) {
        best = client;
        bestOrder = order;
      }
    }
    return best;
  }

  /** Numbers the viewport changes in the order they arrive, so "changed last" needs no clock. */
  #remember(): void {
    const own = this.#deps.awareness.clientID;
    const live = new Set<number>();
    for (const [clientId, raw] of this.#deps.awareness.getStates()) {
      if (clientId === own) continue;
      live.add(clientId);
      const viewport = JSON.stringify(
        parseViewport((raw as Partial<PresenceState> | null)?.viewport),
      );
      const known = this.#seen.get(clientId);
      if (known?.viewport !== viewport)
        this.#seen.set(clientId, { viewport, order: ++this.#order });
    }
    for (const clientId of this.#seen.keys()) if (!live.has(clientId)) this.#seen.delete(clientId);
  }

  #onAwareness = ({
    added,
    updated,
    removed,
  }: {
    added: number[];
    updated: number[];
    removed: number[];
  }): void => {
    const own = this.#deps.awareness.clientID;
    if (![...added, ...updated, ...removed].some((clientId) => clientId !== own)) return;
    this.#remember();
    this.refresh();
  };

  destroy(): void {
    this.#destroyed = true;
    if (this.#staleTimer !== null) clearTimeout(this.#staleTimer);
    this.#deps.awareness.off('change', this.#onAwareness);
    for (const watcher of this.#watchers) watcher.destroy();
  }
}

/** The person a state names, or `null` when it is not in the documented shape (it comes from another browser). */
function personOf(raw: unknown): FollowPerson | null {
  const user = (raw as Partial<PresenceState> | null)?.user;
  if (typeof user?.id !== 'string' || user.id === '' || typeof user.name !== 'string') return null;
  const color =
    typeof user.color === 'string' && HEX_COLOR.test(user.color) ? user.color : IDENTITY_COLORS[0];
  return { id: user.id, name: user.name.slice(0, MAX_NAME_LENGTH), color };
}
