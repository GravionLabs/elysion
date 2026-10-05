import {
  BadGatewayException,
  BadRequestException,
  ForbiddenException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Board, BusinessBackendClient } from './business-backend.client.js';

const TOKEN = 'the-access-token';
const board: Board = { id: '0197a8d2-1c3e-7a10-8000-000000000001', name: 'Retro', createdAt: 'x' };

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
});
