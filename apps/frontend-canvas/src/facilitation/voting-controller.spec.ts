import { describe, expect, it, vi } from 'vitest';
import { VotingController } from './voting-controller';
import type { ApiVoting, VotingApi, VotingSnapshot } from './voting';

const voting = (extra: Partial<ApiVoting> = {}): ApiVoting => ({
  id: 'v1',
  name: 'Pick',
  votesPerPerson: 2,
  status: 'open',
  named: false,
  startedBy: { id: 'u1', name: 'Ada' },
  myVotes: 0,
  myElementVotes: {},
  ...extra,
});

function setup(initial: ApiVoting | null = null) {
  const api = {
    get: vi.fn(() => Promise.resolve(initial)),
    start: vi.fn((options) =>
      Promise.resolve(voting({ name: options.name ?? 'Voting', named: options.named })),
    ),
    vote: vi.fn((_id: string, elementId: string) =>
      Promise.resolve(voting({ myVotes: 1, myElementVotes: { [elementId]: 1 } })),
    ),
    retract: vi.fn(() => Promise.resolve(voting())),
    close: vi.fn(() => Promise.resolve(voting({ status: 'closed', result: [] }))),
    clear: vi.fn(() => Promise.resolve()),
  } satisfies VotingApi;
  const seen: VotingSnapshot[] = [];
  let host: VotingApi | undefined = api;
  const controller = new VotingController({
    api: () => host,
    elements: () => [{ id: 'a', type: 'rectangle' }],
    onChange: (snapshot) => seen.push(snapshot),
    messages: () => ({ notReady: 'not ready' }),
  });
  return { api, controller, seen, withoutApi: () => (host = undefined) };
}

describe('VotingController', () => {
  it('asks the server for the state and announces it', async () => {
    const { controller, seen } = setup(voting({ myVotes: 1, myElementVotes: { a: 1 } }));

    await controller.refresh();

    expect(seen.at(-1)?.view).toMatchObject({ status: 'open', myVotes: 1 });
    expect(seen.at(-1)?.own).toEqual({ a: 1 });
  });

  it('keeps what it knows when the server cannot be reached', async () => {
    const { api, controller, seen } = setup(voting());
    await controller.refresh();
    api.get.mockRejectedValueOnce(new Error('down'));

    await controller.refresh();

    expect(seen.at(-1)?.openSessionId).toBe('v1');
  });

  it('starts a voting with the options sent on, anonymous by default', async () => {
    const { api, controller } = setup();

    await controller.start({ name: ' Pick ', votesPerPerson: 3 });

    expect(api.start).toHaveBeenCalledWith({ name: 'Pick', votesPerPerson: 3, named: false });
  });

  it.each([0, 1.5, 101])('refuses %s votes per person before asking the server', async (votes) => {
    const { api, controller } = setup();

    await expect(controller.start({ votesPerPerson: votes })).rejects.toThrow('between 1 and');
    expect(api.start).not.toHaveBeenCalled();
  });

  it('rejects without a host API', async () => {
    const { controller, withoutApi } = setup();
    withoutApi();

    await expect(controller.start({ votesPerPerson: 2 })).rejects.toThrow('not ready');
  });

  it('votes and shows the answer of the server', async () => {
    const { api, controller, seen } = setup(voting());
    await controller.refresh();

    await controller.vote('a');

    expect(api.vote).toHaveBeenCalledWith('v1', 'a');
    expect(seen.at(-1)?.own).toEqual({ a: 1 });
  });

  it('asks again for the state when a vote is refused', async () => {
    const { api, controller } = setup(voting());
    await controller.refresh();
    api.vote.mockRejectedValueOnce(new Error('409'));

    await controller.vote('a');

    expect(api.get).toHaveBeenCalledTimes(2);
  });

  it('does not vote when no voting is open', async () => {
    const { api, controller } = setup(null);
    await controller.refresh();

    await controller.vote('a');

    expect(api.vote).not.toHaveBeenCalled();
  });

  it('refreshes after a retract that had nothing to take back (204)', async () => {
    const { api, controller } = setup(voting());
    await controller.refresh();
    api.retract.mockResolvedValueOnce(null as unknown as ApiVoting);

    await controller.retract('a');

    expect(api.get).toHaveBeenCalledTimes(2);
  });

  it('ends only an open voting', async () => {
    const { api, controller } = setup(voting());
    await controller.refresh();

    await controller.end();
    await controller.end();

    expect(api.close).toHaveBeenCalledTimes(1);
  });

  it('clears and then asks what is left', async () => {
    const { api, controller } = setup(null);

    await controller.clear();

    expect(api.clear).toHaveBeenCalled();
    expect(api.get).toHaveBeenCalled();
  });

  describe('a broadcast of the realtime service', () => {
    it('shows the start of a voting and fetches the own votes of a voting it did not know', async () => {
      const { api, controller, seen } = setup(voting({ myVotes: 1, myElementVotes: { a: 1 } }));

      controller.handleBroadcast({ event: 'start', voting: { ...voting(), myVotes: undefined } });

      expect(seen.at(-1)?.openSessionId).toBe('v1');
      await vi.waitFor(() => expect(api.get).toHaveBeenCalled());
      await vi.waitFor(() => expect(seen.at(-1)?.own).toEqual({ a: 1 }));
    });

    it('keeps the own votes when somebody else votes', async () => {
      const { controller, seen } = setup(voting({ myVotes: 1, myElementVotes: { a: 1 } }));
      await controller.refresh();

      controller.handleBroadcast({ event: 'vote', voting: { ...voting(), placed: { u2: 1 } } });

      expect(seen.at(-1)?.view?.myVotes).toBe(1);
      expect(seen.at(-1)?.own).toEqual({ a: 1 });
    });

    it('shows the result once the voting is closed', async () => {
      const { controller, seen } = setup(voting());
      await controller.refresh();

      controller.handleBroadcast({
        event: 'close',
        voting: { ...voting({ status: 'closed' }), result: [{ elementId: 'a', count: 3 }] },
      });

      expect(seen.at(-1)?.view?.tally).toEqual([{ elementId: 'a', count: 3, label: 'rectangle' }]);
      expect(seen.at(-1)?.own).toEqual({});
    });

    it('removes the voting when the server says there is none', async () => {
      const { controller, seen } = setup(voting());
      await controller.refresh();

      controller.handleBroadcast({ event: 'clear', voting: null });

      expect(seen.at(-1)?.view).toBeNull();
    });

    it('ignores what is no voting message', async () => {
      const { controller, seen } = setup(voting());
      await controller.refresh();
      const count = seen.length;

      controller.handleBroadcast('x');
      controller.handleBroadcast({ voting: { nonsense: true } });

      expect(seen).toHaveLength(count);
    });
  });

  it('does not let a slow old answer undo a newer one', async () => {
    const { api, controller } = setup(voting());
    await controller.refresh();
    let release!: (value: ApiVoting) => void;
    api.vote.mockReturnValueOnce(new Promise<ApiVoting>((resolve) => (release = resolve)));
    const slow = controller.vote('a');
    api.vote.mockResolvedValueOnce(voting({ myVotes: 2, myElementVotes: { a: 2 } }));
    await controller.vote('a');

    release(voting({ myVotes: 1, myElementVotes: { a: 1 } }));
    await slow;

    expect(controller.read().own).toEqual({ a: 2 });
  });
});
