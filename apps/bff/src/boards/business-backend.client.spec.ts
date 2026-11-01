import {
  GoneException,
  BadGatewayException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Board, BusinessBackendClient } from './business-backend.client.js';

const TOKEN = 'the-access-token';
const board: Board = {
  id: '0197a8d2-1c3e-7a10-8000-000000000001',
  name: 'Retro',
  createdAt: 'x',
  roomId: null,
};
const ROOM = '0197a8d2-1c3e-7a10-8000-0000000000b1';

function respond(status: number, body?: unknown): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('BusinessBackendClient', () => {
  const fetchMock = vi.fn<typeof fetch>();
  let client: BusinessBackendClient;

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
    client = new BusinessBackendClient('http://backend.test:5174');
  });

  afterEach(() => vi.unstubAllGlobals());

  const lastCall = () => {
    const [url, init] = fetchMock.mock.calls.at(-1)!;
    return { url: String(url), init: init! };
  };

  it('lists boards with GET /boards', async () => {
    fetchMock.mockResolvedValue(respond(200, [board]));

    await expect(client.listBoards(TOKEN)).resolves.toEqual([board]);
    expect(lastCall().url).toBe('http://backend.test:5174/boards');
    expect(lastCall().init.method).toBe('GET');
  });

  it('passes a search on as an encoded query', async () => {
    fetchMock.mockResolvedValue(respond(200, [board]));

    await client.listBoards(TOKEN, 'Sprint & Retro');
    expect(lastCall().url).toBe('http://backend.test:5174/boards?query=Sprint%20%26%20Retro');
  });

  it('records an opening and sets or removes a star', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));

    await expect(client.openBoard(TOKEN, board.id)).resolves.toBeUndefined();
    expect(lastCall().url).toBe(`http://backend.test:5174/boards/${board.id}/open`);
    expect(lastCall().init.method).toBe('POST');
    await client.setFavorite(TOKEN, board.id, true);
    expect(lastCall().init.method).toBe('PUT');
    expect(lastCall().url).toBe(`http://backend.test:5174/boards/${board.id}/favorite`);
    await client.setFavorite(TOKEN, board.id, false);
    expect(lastCall().init.method).toBe('DELETE');
  });

  it('makes, lists, revokes and follows invitation links', async () => {
    fetchMock.mockResolvedValue(respond(201, { id: 'i1', token: 't' }));
    await client.createInvitation(TOKEN, 'boards', board.id, { role: 'Viewer', expiresInHours: 2 });
    expect(lastCall().url).toBe(`http://backend.test:5174/boards/${board.id}/invitations`);
    expect(lastCall().init.method).toBe('POST');
    expect(JSON.parse(String(lastCall().init.body))).toEqual({ role: 'Viewer', expiresInHours: 2 });

    fetchMock.mockResolvedValue(respond(200, []));
    await client.listInvitations(TOKEN, 'rooms', 'r1');
    expect(lastCall().url).toBe('http://backend.test:5174/rooms/r1/invitations');

    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
    await expect(client.revokeInvitation(TOKEN, 'rooms', 'r1', 'i1')).resolves.toBeUndefined();
    expect(lastCall().init.method).toBe('DELETE');
    expect(lastCall().url).toBe('http://backend.test:5174/rooms/r1/invitations/i1');

    fetchMock.mockResolvedValue(respond(200, { kind: 'board', id: board.id, role: 'Viewer' }));
    await client.acceptInvitation(TOKEN, 'abc-_');
    expect(lastCall().url).toBe('http://backend.test:5174/invitations/abc-_/accept');
  });

  it('turns the 410 of a link that is no longer valid into a Gone', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 410 }));

    await expect(client.acceptInvitation(TOKEN, 'abc')).rejects.toBeInstanceOf(GoneException);
  });

  it('reads, starts, votes, retracts, closes and clears a voting', async () => {
    const voting = { id: 'v1', status: 'open' };
    fetchMock.mockImplementation(async () => respond(200, voting));
    await expect(client.getVoting(TOKEN, board.id)).resolves.toEqual(voting);
    expect(lastCall().url).toBe(`http://backend.test:5174/boards/${board.id}/voting`);

    fetchMock.mockImplementation(async () => new Response(null, { status: 204 }));
    await expect(client.getVoting(TOKEN, board.id)).resolves.toBeNull();

    fetchMock.mockImplementation(async () => respond(201, voting));
    await client.startVoting(TOKEN, board.id, { votesPerPerson: 3 });
    expect(lastCall().url).toBe(`http://backend.test:5174/boards/${board.id}/votings`);
    expect(JSON.parse(String(lastCall().init.body))).toEqual({ votesPerPerson: 3 });

    fetchMock.mockImplementation(async () => respond(200, voting));
    await client.castVote(TOKEN, board.id, 'v1', 'e 1');
    expect(lastCall().url).toBe(`http://backend.test:5174/boards/${board.id}/votings/v1/votes`);
    await client.retractVote(TOKEN, board.id, 'v1', 'e 1');
    expect(lastCall().url).toBe(
      `http://backend.test:5174/boards/${board.id}/votings/v1/votes/e%201`,
    );
    expect(lastCall().init.method).toBe('DELETE');
    await client.closeVoting(TOKEN, board.id, 'v1');
    expect(lastCall().url).toBe(`http://backend.test:5174/boards/${board.id}/votings/v1/close`);

    fetchMock.mockImplementation(async () => new Response(null, { status: 204 }));
    await expect(client.retractVote(TOKEN, board.id, 'v1', 'e2')).resolves.toBeNull();
    await expect(client.clearVotings(TOKEN, board.id)).resolves.toBeUndefined();
    expect(lastCall().init.method).toBe('DELETE');
  });

  it('searches groups with an encoded query and lists the caller’s own', async () => {
    fetchMock.mockImplementation(() => Promise.resolve(respond(200, [])));

    await client.searchGroups(TOKEN, 'Design & Brand');
    expect(lastCall().url).toBe('http://backend.test:5174/groups?query=Design%20%26%20Brand');
    await client.listMyGroups(TOKEN);
    expect(lastCall().url).toBe('http://backend.test:5174/me/groups');
  });

  it('gives a group a role in a room, lists the groups of the room and removes one', async () => {
    fetchMock.mockImplementation(() =>
      Promise.resolve(respond(200, { groupId: 'g1', name: 'G', role: 'Editor' })),
    );

    await client.setRoomGroupRole(TOKEN, ROOM, 'g1', 'Editor');
    expect(lastCall().url).toBe(`http://backend.test:5174/rooms/${ROOM}/groups/g1`);
    expect(lastCall().init.method).toBe('PUT');
    expect(lastCall().init.body).toBe(JSON.stringify({ role: 'Editor' }));
    await client.listRoomGroups(TOKEN, ROOM);
    expect(lastCall().url).toBe(`http://backend.test:5174/rooms/${ROOM}/groups`);
    fetchMock.mockImplementation(() => Promise.resolve(new Response(null, { status: 204 })));
    await expect(client.removeRoomGroup(TOKEN, ROOM, 'g1')).resolves.toBeUndefined();
    expect(lastCall().init.method).toBe('DELETE');
  });

  it('tells a deactivated account from any other 403 by the code of the backend (#668)', async () => {
    fetchMock.mockResolvedValue(
      respond(403, { title: 'Account deactivated', code: 'account-deactivated' }),
    );
    const deactivated = await client.listBoards(TOKEN).catch((e: unknown) => e);
    fetchMock.mockResolvedValue(respond(403));
    const plain = await client.listBoards(TOKEN).catch((e: unknown) => e);

    expect(deactivated).toBeInstanceOf(ForbiddenException);
    expect((deactivated as ForbiddenException).getResponse()).toMatchObject({
      statusCode: 403,
      code: 'account-deactivated',
    });
    expect(plain).toBeInstanceOf(ForbiddenException);
    expect((plain as ForbiddenException).getResponse()).not.toHaveProperty('code');
  });

  it('gets one board', async () => {
    fetchMock.mockResolvedValue(respond(200, board));

    await expect(client.getBoard(TOKEN, board.id)).resolves.toEqual(board);
    expect(lastCall().url).toBe(`http://backend.test:5174/boards/${board.id}`);
  });

  it("sends the caller's access token on every call, and a content type only with a body", async () => {
    fetchMock.mockImplementation(async () => respond(200, board));
    const calls: Array<() => Promise<unknown>> = [
      () => client.listBoards(TOKEN),
      () => client.getBoard(TOKEN, board.id),
      () => client.createBoard(TOKEN, 'x'),
      () => client.renameBoard(TOKEN, board.id, 'x'),
      () => client.duplicateBoard(TOKEN, board.id),
      () => client.deleteBoard(TOKEN, board.id),
    ];

    for (const call of calls) {
      await call();
      expect((lastCall().init.headers as Record<string, string>).authorization).toBe(
        `Bearer ${TOKEN}`,
      );
    }
    await client.getBoard(TOKEN, board.id);
    expect(lastCall().init.headers).toEqual({ authorization: `Bearer ${TOKEN}` });
  });

  it('creates with a JSON body', async () => {
    fetchMock.mockResolvedValue(respond(201, board));

    await client.createBoard(TOKEN, 'Retro');

    expect(lastCall().init.method).toBe('POST');
    expect(lastCall().init.body).toBe(JSON.stringify({ name: 'Retro' }));
    expect(lastCall().init.headers).toEqual({
      authorization: `Bearer ${TOKEN}`,
      'content-type': 'application/json',
    });
  });

  it('renames with PATCH', async () => {
    fetchMock.mockResolvedValue(respond(200, board));

    await client.renameBoard(TOKEN, board.id, 'New');

    expect(lastCall().init.method).toBe('PATCH');
    expect(lastCall().url).toBe(`http://backend.test:5174/boards/${board.id}`);
    expect(lastCall().init.body).toBe(JSON.stringify({ name: 'New' }));
  });

  it('duplicates with POST and no body', async () => {
    fetchMock.mockResolvedValue(respond(201, { ...board, name: 'Retro (copy)' }));

    const copy = await client.duplicateBoard(TOKEN, board.id);

    expect(copy.name).toBe('Retro (copy)');
    const { url, init } = lastCall();
    expect(url).toBe(`http://backend.test:5174/boards/${board.id}/duplicate`);
    expect(init.method).toBe('POST');
    expect(init.body).toBeUndefined();
  });

  it('deletes and accepts the empty 204 answer', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));

    await expect(client.deleteBoard(TOKEN, board.id)).resolves.toBeUndefined();
    expect(lastCall().init.method).toBe('DELETE');
  });

  it("asks for the caller's role and lower-cases it", async () => {
    fetchMock.mockResolvedValue(respond(200, { boardId: board.id, role: 'Editor' }));

    await expect(client.getMyRole(TOKEN, board.id)).resolves.toBe('editor');
    expect(lastCall().url).toBe(`http://backend.test:5174/boards/${board.id}/membership/me`);
    expect((lastCall().init.headers as Record<string, string>).authorization).toBe(
      `Bearer ${TOKEN}`,
    );
  });

  it('has no role when the backend answers 404', async () => {
    fetchMock.mockResolvedValue(respond(404));

    await expect(client.getMyRole(TOKEN, board.id)).resolves.toBeNull();
  });

  it('does not make up a role: an unknown one, a 401 and a failure are errors', async () => {
    fetchMock.mockResolvedValue(respond(200, { boardId: board.id, role: 'Superuser' }));
    await expect(client.getMyRole(TOKEN, board.id)).rejects.toBeInstanceOf(BadGatewayException);

    fetchMock.mockResolvedValue(respond(401));
    await expect(client.getMyRole(TOKEN, board.id)).rejects.toBeInstanceOf(UnauthorizedException);

    fetchMock.mockResolvedValue(respond(500));
    await expect(client.getMyRole(TOKEN, board.id)).rejects.toBeInstanceOf(BadGatewayException);
  });

  it('keeps a 401 as 401: the backend did not accept the token', async () => {
    fetchMock.mockResolvedValue(respond(401));

    await expect(client.listBoards(TOKEN)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('keeps a 403 as 403: a member whose role is too low', async () => {
    fetchMock.mockResolvedValue(respond(403));

    await expect(client.deleteBoard(TOKEN, board.id)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('keeps a 404 as 404', async () => {
    fetchMock.mockResolvedValue(respond(404));

    await expect(client.getBoard(TOKEN, board.id)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('keeps a 400 as 400 and carries the backend message', async () => {
    fetchMock.mockResolvedValue(
      respond(400, {
        title: 'One or more validation errors occurred.',
        errors: { name: ['Too long.'] },
      }),
    );

    const error = await client.createBoard(TOKEN, 'x').catch((e: unknown) => e);

    expect(error).toBeInstanceOf(BadRequestException);
    expect((error as BadRequestException).message).toBe('Too long.');
  });

  it('falls back to a generic 400 message when the body is not problem details', async () => {
    fetchMock.mockResolvedValue(new Response('nope', { status: 400 }));

    const error = await client.createBoard(TOKEN, 'x').catch((e: unknown) => e);

    expect((error as BadRequestException).message).toBe('Invalid request.');
  });

  it('turns an upstream failure into 502', async () => {
    fetchMock.mockResolvedValue(respond(500));

    const error = await client.listBoards(TOKEN).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(BadGatewayException);
    expect((error as BadGatewayException).message).toContain('500');
  });

  it('turns an unreachable backend into 502', async () => {
    fetchMock.mockRejectedValue(new TypeError('fetch failed'));

    await expect(client.listBoards(TOKEN)).rejects.toBeInstanceOf(BadGatewayException);
  });

  describe('members', () => {
    const member = { userId: 'u1', displayName: 'Ada', email: 'ada@example.com', role: 'Editor' };

    it("lists, adds, changes and removes with the caller's token on the board's members route", async () => {
      fetchMock.mockResolvedValueOnce(respond(200, [member]));
      await expect(client.listMembers(TOKEN, board.id)).resolves.toEqual([member]);
      expect(lastCall().url).toBe(`http://backend.test:5174/boards/${board.id}/members`);

      fetchMock.mockResolvedValueOnce(respond(201, member));
      await client.addMember(TOKEN, board.id, { email: 'ada@example.com' }, 'Editor');
      expect(lastCall().init.method).toBe('POST');
      expect(lastCall().init.body).toBe(
        JSON.stringify({ email: 'ada@example.com', role: 'Editor' }),
      );

      fetchMock.mockResolvedValueOnce(respond(201, member));
      await client.addMember(TOKEN, board.id, { userId: 'u9' }, 'Viewer');
      expect(lastCall().init.body).toBe(JSON.stringify({ userId: 'u9', role: 'Viewer' }));

      fetchMock.mockResolvedValueOnce(respond(200, member));
      await client.changeMemberRole(TOKEN, board.id, 'u1', 'Viewer');
      expect(lastCall().init.method).toBe('PATCH');
      expect(lastCall().url).toBe(`http://backend.test:5174/boards/${board.id}/members/u1`);
      expect(lastCall().init.body).toBe(JSON.stringify({ role: 'Viewer' }));

      fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
      await expect(client.removeMember(TOKEN, board.id, 'u1')).resolves.toBeUndefined();
      expect(lastCall().init.method).toBe('DELETE');
      expect((lastCall().init.headers as Record<string, string>).authorization).toBe(
        `Bearer ${TOKEN}`,
      );
    });

    it("carries the backend's message on a 404 and a 409", async () => {
      fetchMock.mockResolvedValue(
        respond(404, { detail: 'No user with this email has logged in yet.' }),
      );
      const notFound = await client
        .addMember(TOKEN, board.id, { email: 'x@y.z' }, 'Viewer')
        .catch((e: unknown) => e);
      expect(notFound).toBeInstanceOf(NotFoundException);
      expect((notFound as NotFoundException).message).toBe(
        'No user with this email has logged in yet.',
      );

      fetchMock.mockResolvedValue(respond(409, { detail: 'A board needs at least one owner.' }));
      const conflict = await client.removeMember(TOKEN, board.id, 'u1').catch((e: unknown) => e);
      expect(conflict).toBeInstanceOf(ConflictException);
      expect((conflict as ConflictException).message).toBe('A board needs at least one owner.');
    });

    it('keeps a 404 without a body a plain 404 (a board the caller cannot see)', async () => {
      fetchMock.mockResolvedValue(respond(404));

      const error = await client.listMembers(TOKEN, board.id).catch((e: unknown) => e);

      expect(error).toBeInstanceOf(NotFoundException);
      expect((error as NotFoundException).message).toBe('Not Found');
    });
  });

  describe('rooms', () => {
    it('lists the rooms with GET /rooms', async () => {
      const room = { id: ROOM, name: 'Sprint', createdAt: 'x', role: 'Owner' };
      fetchMock.mockImplementation(async () => respond(200, [room]));

      await expect(client.listRooms(TOKEN)).resolves.toEqual([room]);
      expect(lastCall().url).toBe('http://backend.test:5174/rooms');
      expect(lastCall().init.method).toBe('GET');
    });

    it('creates, renames and deletes a room with the name in the body', async () => {
      fetchMock.mockImplementation(async () => respond(200, {}));
      await client.createRoom(TOKEN, 'Sprint');
      expect(lastCall().init.method).toBe('POST');
      expect(lastCall().url).toBe('http://backend.test:5174/rooms');
      expect(lastCall().init.body).toBe(JSON.stringify({ name: 'Sprint' }));

      await client.renameRoom(TOKEN, ROOM, 'New');
      expect(lastCall().init.method).toBe('PATCH');
      expect(lastCall().url).toBe(`http://backend.test:5174/rooms/${ROOM}`);

      fetchMock.mockImplementation(async () => respond(204));
      await expect(client.deleteRoom(TOKEN, ROOM)).resolves.toBeUndefined();
      expect(lastCall().init.method).toBe('DELETE');
    });

    it('moves a board into a room and out of it with PUT /boards/:id/room', async () => {
      fetchMock.mockImplementation(async () => respond(200, board));

      await client.moveBoard(TOKEN, board.id, ROOM);
      expect(lastCall().init.method).toBe('PUT');
      expect(lastCall().url).toBe(`http://backend.test:5174/boards/${board.id}/room`);
      expect(lastCall().init.body).toBe(JSON.stringify({ roomId: ROOM }));

      await client.moveBoard(TOKEN, board.id, null);
      expect(lastCall().init.body).toBe(JSON.stringify({ roomId: null }));
    });

    it('searches people with the query encoded, on the users route', async () => {
      fetchMock.mockResolvedValueOnce(
        respond(200, [{ id: 'u1', displayName: 'Ada', email: null }]),
      );

      await expect(client.searchUsers(TOKEN, 'ada & co')).resolves.toEqual([
        { id: 'u1', displayName: 'Ada', email: null },
      ]);
      expect(lastCall().url).toBe('http://backend.test:5174/users?query=ada%20%26%20co');
      expect(lastCall().init.method).toBe('GET');
    });

    it('talks to the room member routes', async () => {
      fetchMock.mockImplementation(async () => respond(200, []));
      await client.listRoomMembers(TOKEN, ROOM);
      expect(lastCall().url).toBe(`http://backend.test:5174/rooms/${ROOM}/members`);

      await client.addRoomMember(TOKEN, ROOM, { email: 'a@b.c' }, 'Editor');
      expect(lastCall().init.body).toBe(JSON.stringify({ email: 'a@b.c', role: 'Editor' }));

      await client.changeRoomMemberRole(TOKEN, ROOM, 'u1', 'Viewer');
      expect(lastCall().url).toBe(`http://backend.test:5174/rooms/${ROOM}/members/u1`);
      expect(lastCall().init.method).toBe('PATCH');

      fetchMock.mockImplementation(async () => respond(204));
      await client.removeRoomMember(TOKEN, ROOM, 'u1');
      expect(lastCall().init.method).toBe('DELETE');
    });

    it("keeps the backend's message for a room that does not exist for the caller", async () => {
      fetchMock.mockImplementation(async () =>
        respond(404, { detail: 'The room does not exist.' }),
      );

      await expect(client.moveBoard(TOKEN, board.id, ROOM)).rejects.toThrow(
        new NotFoundException('The room does not exist.'),
      );
    });
  });

  // #898: an id from a request never leaves the backend's path or host.
  describe('ids in the path', () => {
    it.each([
      ['a slash', 'a/b', 'http://backend.test:5174/templates/a%2Fb'],
      ['a question mark', 'x?admin=1', 'http://backend.test:5174/templates/x%3Fadmin%3D1'],
      ['a hash', 'x#y', 'http://backend.test:5174/templates/x%23y'],
      ['a host', '//evil.example', 'http://backend.test:5174/templates/%2F%2Fevil.example'],
      ['a climb', '../admin/stats', 'http://backend.test:5174/templates/..%2Fadmin%2Fstats'],
      ['a percent', '%2e%2e', 'http://backend.test:5174/templates/%252e%252e'],
    ])('encodes %s as one segment', async (_, id, expected) => {
      fetchMock.mockResolvedValue(respond(200, {}));

      await client.getTemplate(TOKEN, id);

      expect(lastCall().url).toBe(expected);
      expect(new URL(lastCall().url).host).toBe('backend.test:5174');
    });

    it('encodes every segment of a nested path', async () => {
      fetchMock.mockResolvedValue(new Response(null, { status: 204 }));

      await client.removeRoomMember(TOKEN, '../boards', '//evil.example/x?y#z');

      expect(lastCall().url).toBe(
        'http://backend.test:5174/rooms/..%2Fboards/members/%2F%2Fevil.example%2Fx%3Fy%23z',
      );
    });

    it('keeps a query string after an encoded id', async () => {
      fetchMock.mockResolvedValue(respond(200, []));

      await client.adminListGroupMembers(TOKEN, 'g/1', { query: 'a b', page: 2 });

      expect(lastCall().url).toBe(
        'http://backend.test:5174/admin/groups/g%2F1/members?query=a+b&page=2',
      );
    });

    it('encodes the ids of a webhook path', async () => {
      fetchMock.mockResolvedValue(respond(200, {}));

      await client.redeliverWebhook(TOKEN, 'b/1', 'w?1', '#d');

      expect(lastCall().url).toBe(
        'http://backend.test:5174/boards/b%2F1/webhooks/w%3F1/deliveries/%23d/redeliver',
      );
    });

    it.each(['..', '.'])(
      'refuses the id %j, which would drop a segment, before calling the backend',
      async (id) => {
        await expect(client.getTemplate(TOKEN, id)).rejects.toThrow(BadRequestException);
        expect(fetchMock).not.toHaveBeenCalled();
      },
    );

    it('keeps the base path of the configured base URL', async () => {
      fetchMock.mockResolvedValue(respond(200, {}));
      const prefixed = new BusinessBackendClient('http://backend.test:5174/api/');

      await prefixed.getTemplate(TOKEN, board.id);
      expect(lastCall().url).toBe(`http://backend.test:5174/api/templates/${board.id}`);

      await expect(prefixed.getTemplate(TOKEN, '..')).rejects.toThrow(BadRequestException);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
  });
});
