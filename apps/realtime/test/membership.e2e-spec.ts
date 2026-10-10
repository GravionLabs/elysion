import type { BoardRole } from '@elysion/shared-types';
import { MembershipSource } from '../src/membership/membership-source.js';
import { InMemoryDocumentStore } from '../src/persistence/in-memory-document-store.js';
import { SyncClient, startInstance, waitUntil } from './helpers.js';
import { boardUrl } from './ws-token.js';

/**
 * A WS token proves the role a person had when it was issued; an open socket outlives it (#772). The service asks the
 * business backend again while the socket is open: a person who lost their role is disconnected (4403), a lowered role
 * applies at once, and an unreachable backend changes nothing.
 */
class FakeMembership extends MembershipSource {
  readonly roles = new Map<string, BoardRole>();
  down = false;

  grant(boardId: string, sub: string, role: BoardRole): void {
    this.roles.set(`${boardId}/${sub}`, role);
  }

  revoke(boardId: string, sub: string): void {
    this.roles.delete(`${boardId}/${sub}`);
  }

  roleOf(boardId: string, sub: string): Promise<BoardRole | null> {
    if (this.down) return Promise.reject(new Error('backend down'));
    return Promise.resolve(this.roles.get(`${boardId}/${sub}`) ?? null);
  }
}

describe('membership of an open connection (e2e)', () => {
  let app: Awaited<ReturnType<typeof startInstance>>['app'];
  let url: string;
  const membership = new FakeMembership();
  const board = () => `member-${Date.now()}-${Math.random().toString(36).slice(2)}`;

  beforeAll(async () => {
    ({ app, url } = await startInstance(new InMemoryDocumentStore(), {}, undefined, {
      source: membership,
      intervalMs: 50,
    }));
  });

  afterAll(async () => {
    await app.close();
  });

  const settle = (ms = 300) => new Promise((resolve) => setTimeout(resolve, ms));

  it('closes the socket of a member who was removed, and leaves the others alone', async () => {
    const id = board();
    membership.grant(id, 'owner', 'owner');
    membership.grant(id, 'ed', 'editor');
    const owner = new SyncClient(boardUrl(url, id, { sub: 'owner', role: 'owner' }));
    const editor = new SyncClient(boardUrl(url, id, { sub: 'ed', role: 'editor' }));
    await Promise.all([owner.waitForOpen(), editor.waitForOpen()]);
    editor.doc.getMap('elements').set('before', 1);
    await waitUntil(() => owner.doc.getMap('elements').has('before'));

    membership.revoke(id, 'ed');

    expect(await editor.closed).toBe(4403);
    owner.doc.getMap('elements').set('after', 1);
    await settle();
    expect(owner.doc.getMap('elements').has('after')).toBe(true);
    owner.close();
  });

  it('closes every socket of a member, however many they have open', async () => {
    const id = board();
    membership.grant(id, 'ed', 'editor');
    const first = new SyncClient(boardUrl(url, id, { sub: 'ed', role: 'editor' }));
    const second = new SyncClient(boardUrl(url, id, { sub: 'ed', role: 'editor' }));
    await Promise.all([first.waitForOpen(), second.waitForOpen()]);

    membership.revoke(id, 'ed');

    expect(await Promise.all([first.closed, second.closed])).toEqual([4403, 4403]);
  });

  it('closes the sockets of a board that was deleted: nobody has a role on it', async () => {
    const id = board();
    membership.grant(id, 'owner', 'owner');
    const owner = new SyncClient(boardUrl(url, id, { sub: 'owner', role: 'owner' }));
    await owner.waitForOpen();

    membership.revoke(id, 'owner');

    expect(await owner.closed).toBe(4403);
  });

  it('stops the writes of an editor who was lowered to viewer, without closing the socket', async () => {
    const id = board();
    membership.grant(id, 'owner', 'owner');
    membership.grant(id, 'ed', 'editor');
    const owner = new SyncClient(boardUrl(url, id, { sub: 'owner', role: 'owner' }));
    const editor = new SyncClient(boardUrl(url, id, { sub: 'ed', role: 'editor' }));
    await Promise.all([owner.waitForOpen(), editor.waitForOpen()]);
    editor.doc.getMap('elements').set('allowed', 1);
    await waitUntil(() => owner.doc.getMap('elements').has('allowed'));

    membership.grant(id, 'ed', 'viewer');
    await settle();
    editor.doc.getMap('elements').set('refused', 1);
    owner.doc.getMap('elements').set('seen', 1);

    await waitUntil(() => editor.doc.getMap('elements').has('seen'));
    await settle();
    expect(owner.doc.getMap('elements').has('refused')).toBe(false);
    owner.close();
    editor.close();
  });

  it('keeps everybody connected while the backend cannot be reached', async () => {
    const id = board();
    membership.grant(id, 'ed', 'editor');
    const editor = new SyncClient(boardUrl(url, id, { sub: 'ed', role: 'editor' }));
    await editor.waitForOpen();

    membership.down = true;
    membership.revoke(id, 'ed');
    await settle(400);
    let closed = false;
    void editor.closed.then(() => (closed = true));
    await settle(50);
    expect(closed).toBe(false);

    membership.down = false;
    expect(await editor.closed).toBe(4403);
  });
});
