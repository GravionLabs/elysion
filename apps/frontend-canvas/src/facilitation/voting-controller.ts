import {
  type ApiVoting,
  type StartOptions,
  type VotableElement,
  type VotingApi,
  type VotingSnapshot,
  MAX_SESSION_NAME_LENGTH,
  MAX_VOTES_PER_PERSON,
  snapshotOf,
} from './voting';

/** What the realtime service sends when somebody changes the voting (message `voting`, ADR 0029). */
export interface VotingBroadcast {
  event?: string;
  voting: (Omit<ApiVoting, 'myVotes' | 'myElementVotes'> & Partial<ApiVoting>) | null;
}

export interface VotingControllerOptions {
  /** The host's API; read on every call, so one that is set later is used. */
  api: () => VotingApi | undefined;
  /** The elements of the board as the scene has them (deleted ones flagged). */
  elements: () => readonly VotableElement[];
  onChange: (snapshot: VotingSnapshot) => void;
  /** Words for errors the controller itself makes. */
  messages: () => { notReady: string };
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * The voting of one board as one person sees it (ADR 0029). It holds the last state the server told this client, changes
 * it with the answers of the client's own calls and with the broadcasts of others, and announces a snapshot when it
 * changed. A response that overtakes an older one is not undone by it (each call has a number).
 */
export class VotingController {
  #current: ApiVoting | null = null;
  #last = JSON.stringify(snapshotOf(null, []));
  #sent = 0;
  #applied = 0;
  #destroyed = false;
  readonly #options: VotingControllerOptions;

  constructor(options: VotingControllerOptions) {
    this.#options = options;
  }

  get current(): ApiVoting | null {
    return this.#current;
  }

  read(): VotingSnapshot {
    return snapshotOf(this.#current, this.#options.elements());
  }

  /** Tells the callback the current snapshot again, also when it did not change. */
  emit(): void {
    const snapshot = this.read();
    this.#last = JSON.stringify(snapshot);
    this.#options.onChange(snapshot);
  }

  /** Announces the snapshot when it differs from the last one told: a change of the elements can change a result. */
  check(): void {
    const snapshot = this.read();
    const json = JSON.stringify(snapshot);
    if (json === this.#last) return;
    this.#last = json;
    this.#options.onChange(snapshot);
  }

  /** Asks the server for the state (when connecting, and after a failed call). A failure keeps what is known. */
  async refresh(): Promise<void> {
    const api = this.#options.api();
    if (!api) return;
    const seq = ++this.#sent;
    try {
      this.#apply(await api.get(), seq);
    } catch {
      // Offline or the server is down: the next connect asks again.
    }
  }

  #apply(voting: ApiVoting | null, seq: number): void {
    if (this.#destroyed || seq < this.#applied) return;
    this.#applied = seq;
    this.#current = voting;
    this.check();
  }

  #api(): VotingApi {
    const api = this.#options.api();
    if (!api) throw new Error(this.#options.messages().notReady);
    return api;
  }

  async start(options: StartOptions): Promise<void> {
    const votes = options.votesPerPerson;
    if (!Number.isInteger(votes) || votes < 1 || votes > MAX_VOTES_PER_PERSON) {
      throw new RangeError(
        `The votes per person must be a whole number between 1 and ${MAX_VOTES_PER_PERSON}.`,
      );
    }
    const api = this.#api();
    const seq = ++this.#sent;
    const voting = await api.start({
      name: (options.name ?? '').trim().slice(0, MAX_SESSION_NAME_LENGTH) || undefined,
      votesPerPerson: votes,
      named: options.named === true,
    });
    this.#apply(voting, seq);
  }

  /** A vote for an element in the open voting. A refusal (no vote left, closed meanwhile) is answered by asking for the state. */
  async vote(elementId: string): Promise<void> {
    await this.#own((api, id) => api.vote(id, elementId));
  }

  async retract(elementId: string): Promise<void> {
    await this.#own((api, id) => api.retract(id, elementId));
  }

  async #own(run: (api: VotingApi, votingId: string) => Promise<ApiVoting | null>): Promise<void> {
    const open = this.#current;
    const api = this.#options.api();
    if (!api || !open || open.status !== 'open') return;
    const seq = ++this.#sent;
    try {
      const voting = await run(api, open.id);
      if (voting) this.#apply(voting, seq);
      else await this.refresh();
    } catch {
      await this.refresh();
    }
  }

  /** Closes the open voting; a no-op when none is open. */
  async end(): Promise<void> {
    const open = this.#current;
    if (!open || open.status !== 'open') return;
    const api = this.#api();
    const seq = ++this.#sent;
    this.#apply(await api.close(open.id), seq);
  }

  /** Removes the results: every closed voting. An open one stays; a no-op when there is nothing closed. */
  async clear(): Promise<void> {
    const api = this.#api();
    const seq = ++this.#sent;
    await api.clear();
    // The server decides what is left (an open voting stays): ask for it.
    this.#sent = seq;
    await this.refresh();
  }

  /** A broadcast of the realtime service: somebody started, voted, closed or cleared. */
  handleBroadcast(payload: unknown): void {
    if (!isObject(payload)) return;
    const message = payload as unknown as VotingBroadcast;
    const incoming = message.voting;
    if (incoming === null) {
      this.#current = null;
      this.check();
      return;
    }
    if (!isObject(incoming) || typeof (incoming as { id?: unknown }).id !== 'string') return;
    const known = this.#current?.id === incoming.id ? this.#current : null;
    this.#current = {
      ...incoming,
      myVotes: known?.myVotes ?? 0,
      myElementVotes: known?.myElementVotes ?? {},
    } as ApiVoting;
    this.check();
    // A voting that is open and was not known: this client may have votes in it already (it joined late).
    if (!known && incoming.status === 'open') void this.refresh();
  }

  destroy(): void {
    this.#destroyed = true;
  }
}
