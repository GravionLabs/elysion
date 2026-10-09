import { createServer, IncomingMessage, Server } from 'node:http';
import { AddressInfo } from 'node:net';
import { randomUUID } from 'node:crypto';

interface FakeBoard {
  id: string;
  name: string;
  createdAt: string;
  roomId: string | null;
}

interface FakeRoom {
  id: string;
  name: string;
  createdAt: string;
  role: string;
}

interface FakeMember {
  userId: string;
  displayName: string;
  email: string | null;
  role: string;
}

/**
 * A stand-in for the business backend's Board API (apps/business-backend, `BoardsController`):
 * same routes and status codes, boards kept in memory. It counts the requests it receives so a test
 * can tell that the BFF answered without calling it.
 */
export class FakeBusinessBackend {
  readonly boards = new Map<string, FakeBoard>();
  requests = 0;
  /** The role per board id the caller has (`Owner`, `Editor`, `Viewer`); a board that is not in here: 404, as for a non-member. */
  readonly roles = new Map<string, string>();
  /** Answer every `membership/me` call with this status instead (an outage, a rejected token). */
  membershipStatus: number | null = null;
  /** The member list per board id, served by the member routes; a board with no entry has no members (404). */
  readonly members = new Map<
    string,
    Array<{ userId: string; displayName: string; email: string | null; role: string }>
  >();
  /** Answers every member route with this status and a problem-details body (a refusal of the backend's rules). */
  memberRefusal: { status: number; detail: string } | null = null;
  /** The last member request: method, path and parsed body. */
  lastMemberRequest: { method: string; path: string; body: unknown } | null = null;
  /** The caller's rooms, served by the room routes (`role` is the caller's role in the room). */
  readonly rooms = new Map<string, FakeRoom>();
  /** The member list per room id, served by the room member routes; a room with no entry has no members (404). */
  readonly roomMembers = new Map<string, FakeMember[]>();
  /** Answers every room route (`/rooms...` and `PUT /boards/:id/room`) with this status and a problem-details body. */
  roomRefusal: { status: number; detail: string } | null = null;
  /** The last room request: method, path and parsed body. */
  lastRoomRequest: { method: string; path: string; body: unknown } | null = null;
  /** The template catalog, served by the template routes. */
  templates = [
    {
      id: '0b6f1c1e-5d3a-4f0e-9a51-6c1d2f3a4b01',
      name: 'Retrospective',
      description: 'Three columns.',
      isBuiltIn: true,
      createdAt: '2026-10-06T00:00:00+00:00',
      scene: '{"type":"excalidraw","version":2,"elements":[]}',
    },
  ];
  /** The last template POST or DELETE: method, path and parsed body. */
  lastTemplateRequest: { method: string; path: string; body: unknown } | null = null;
  /** Answers every template POST or DELETE with this status (a refusal of the backend's rules). */
  templateRefusal: number | null = null;
  /** The files of boards, by `boardId/fileId`: what the file routes received and serve. */
  readonly files = new Map<string, { contentType: string; bytes: Buffer }>();
  /** The bytes of the file being uploaded that have arrived so far (a test reads it while the upload is still running). */
  uploadedSoFar = 0;
  /** With `fileRefusal`: answer at once, without reading the body (as the real backend does when a file is too large). */
  fileRefusalEarly = false;
  /** Answers every file PUT with this status (a refusal of the backend's rules: 413, 415, 409). */
  fileRefusal: number | null = null;
  /** The `Authorization` header of every request, in order. */
  readonly authorizations: Array<string | undefined> = [];
  /** The `X-Request-Id` of every request, in order (ADR 0025). */
  readonly requestIds: Array<string | undefined> = [];
  #server: Server | null = null;

  get url(): string {
    return `http://127.0.0.1:${(this.#server!.address() as AddressInfo).port}`;
  }

  async start(): Promise<void> {
    this.#server = createServer((req, res) => void this.#handle(req, res));
    await new Promise<void>((resolve) => this.#server!.listen(0, '127.0.0.1', resolve));
  }

  /** Safe to call twice: a test may stop the server itself to simulate an outage. */
  async stop(): Promise<void> {
    const server = this.#server;
    if (!server) return;
    this.#server = null;
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
      server.closeAllConnections();
    });
  }

  async #handle(req: IncomingMessage, res: import('node:http').ServerResponse): Promise<void> {
    this.requests += 1;
    this.authorizations.push(req.headers.authorization);
    this.requestIds.push(req.headers['x-request-id'] as string | undefined);
    const send = (status: number, body?: unknown) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(body === undefined ? undefined : JSON.stringify(body));
    };
    const templateRoute = /^\/templates(?:\/([^/]+))?$/.exec(req.url ?? '');
    if (templateRoute && (req.method === 'POST' || req.method === 'DELETE')) {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(chunk as Buffer);
      const body = chunks.length > 0 ? JSON.parse(Buffer.concat(chunks).toString()) : null;
      this.lastTemplateRequest = { method: req.method, path: req.url ?? '', body };
      if (this.templateRefusal) return send(this.templateRefusal);
      if (req.method === 'POST') {
        const template = {
          id: randomUUID(),
          name: body.name,
          description: body.description ?? '',
          isBuiltIn: false,
          createdAt: new Date().toISOString(),
          scene: body.scene,
        };
        this.templates.push(template);
        return send(201, template);
      }
      const index = this.templates.findIndex((t) => t.id === templateRoute[1]);
      if (index < 0) return send(404);
      this.templates.splice(index, 1);
      return send(204);
    }
    if (templateRoute && req.method === 'GET') {
      const id = templateRoute[1];
      if (!id)
        return send(
          200,
          this.templates.map(({ scene: _scene, ...summary }) => summary),
        );
      const template = this.templates.find((t) => t.id === id);
      return template ? send(200, template) : send(404);
    }
    const roomRoute = /^\/rooms(?:\/([^/]+?)(?:\/members(?:\/([^/]+))?)?)?$/.exec(req.url ?? '');
    const moveRoute = /^\/boards\/([^/]+)\/room$/.exec(req.url ?? '');
    if (roomRoute || moveRoute) return this.#handleRoom(req, res, roomRoute, moveRoute);
    const memberRoute = /^\/boards\/([^/]+)\/members(?:\/([^/]+))?$/.exec(req.url ?? '');
    if (memberRoute) {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(chunk as Buffer);
      const body = chunks.length > 0 ? JSON.parse(Buffer.concat(chunks).toString()) : null;
      this.lastMemberRequest = { method: req.method ?? '', path: req.url ?? '', body };
      if (this.memberRefusal) {
        res.writeHead(this.memberRefusal.status, { 'content-type': 'application/problem+json' });
        return void res.end(
          JSON.stringify({ title: 'Refused', detail: this.memberRefusal.detail }),
        );
      }
      const list = this.members.get(memberRoute[1]);
      if (!list) return send(404);
      const userId = memberRoute[2];
      if (req.method === 'GET' && !userId) return send(200, list);
      if (req.method === 'POST' && !userId) {
        const member = {
          userId: randomUUID(),
          displayName: body.email,
          email: body.email,
          role: body.role,
        };
        list.push(member);
        return send(201, member);
      }
      const member = list.find((m) => m.userId === userId);
      if (!member) return send(404);
      if (req.method === 'PATCH') {
        member.role = body.role;
        return send(200, member);
      }
      if (req.method === 'DELETE') {
        list.splice(list.indexOf(member), 1);
        return send(204);
      }
      return send(405);
    }
    const fileRoute = /^\/boards\/([^/]+)\/files\/([^/]+)$/.exec(req.url ?? '');
    if (fileRoute) {
      const key = `${fileRoute[1]}/${fileRoute[2]}`;
      if (req.method === 'PUT') {
        if (this.fileRefusal && this.fileRefusalEarly) return send(this.fileRefusal);
        const parts: Buffer[] = [];
        this.uploadedSoFar = 0;
        for await (const chunk of req) {
          parts.push(chunk as Buffer);
          this.uploadedSoFar += (chunk as Buffer).length;
        }
        if (this.fileRefusal) return send(this.fileRefusal);
        this.files.set(key, {
          contentType: String(req.headers['content-type']),
          bytes: Buffer.concat(parts),
        });
        return send(204);
      }
      const file = this.files.get(key);
      if (!file) return send(404);
      res.writeHead(200, {
        'content-type': file.contentType,
        'content-length': file.bytes.length,
        'cache-control': 'private, max-age=31536000, immutable',
        'x-content-type-options': 'nosniff',
        'x-internal': 'must-not-be-passed-on',
      });
      return void res.end(file.bytes);
    }
    const membership = /^\/boards\/([^/]+)\/membership\/me$/.exec(req.url ?? '');
    if (membership) {
      if (this.membershipStatus !== null) return send(this.membershipStatus);
      const role = this.roles.get(membership[1]);
      return role ? send(200, { boardId: membership[1], role }) : send(404);
    }
    const match = /^\/boards(?:\/([^/]+?)(\/duplicate)?)?$/.exec(req.url ?? '');
    if (!match) return send(404);
    const id = match[1];
    const duplicate = match[2] === '/duplicate';

    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const body = chunks.length > 0 ? JSON.parse(Buffer.concat(chunks).toString()) : null;
    const name = typeof body?.name === 'string' ? body.name.trim() : '';
    const invalid = () =>
      send(400, {
        title: 'One or more validation errors occurred.',
        errors: { name: ['The name must be between 1 and 120 characters.'] },
      });

    if (!id && req.method === 'GET') return send(200, [...this.boards.values()].reverse());
    if (!id && req.method === 'POST') {
      if (name.length < 1 || name.length > 120) return invalid();
      const board = { id: randomUUID(), name, createdAt: new Date().toISOString(), roomId: null };
      this.boards.set(board.id, board);
      return send(201, board);
    }
    const board = id ? this.boards.get(id) : undefined;
    if (id && !board) return send(404);
    if (duplicate && req.method === 'POST') {
      const copy = {
        id: randomUUID(),
        name: `${board!.name} (copy)`,
        createdAt: new Date().toISOString(),
        roomId: null,
      };
      this.boards.set(copy.id, copy);
      return send(201, copy);
    }
    if (req.method === 'GET') return send(200, board);
    if (req.method === 'PATCH') {
      if (name.length < 1 || name.length > 120) return invalid();
      board!.name = name;
      return send(200, board);
    }
    if (req.method === 'DELETE') {
      this.boards.delete(id!);
      return send(204);
    }
    return send(405);
  }

  /** The room routes: rooms, their members, and moving a board into a room. */
  async #handleRoom(
    req: IncomingMessage,
    res: import('node:http').ServerResponse,
    roomRoute: RegExpExecArray | null,
    moveRoute: RegExpExecArray | null,
  ): Promise<void> {
    const send = (status: number, body?: unknown) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(body === undefined ? undefined : JSON.stringify(body));
    };
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const body = chunks.length > 0 ? JSON.parse(Buffer.concat(chunks).toString()) : null;
    this.lastRoomRequest = { method: req.method ?? '', path: req.url ?? '', body };
    if (this.roomRefusal) {
      res.writeHead(this.roomRefusal.status, { 'content-type': 'application/problem+json' });
      return void res.end(JSON.stringify({ title: 'Refused', detail: this.roomRefusal.detail }));
    }

    if (moveRoute) {
      const board = this.boards.get(moveRoute[1]);
      if (!board) return send(404);
      if (body.roomId !== null && !this.rooms.has(body.roomId)) return send(404);
      board.roomId = body.roomId;
      return send(200, board);
    }

    const [, id, userId] = roomRoute!;
    const isMembers = (req.url ?? '').includes('/members');
    const invalid = () =>
      send(400, {
        title: 'One or more validation errors occurred.',
        errors: { name: ['The name must be between 1 and 120 characters.'] },
      });
    if (!id) {
      if (req.method === 'GET') return send(200, [...this.rooms.values()]);
      const name = typeof body?.name === 'string' ? body.name.trim() : '';
      if (name.length < 1 || name.length > 120) return invalid();
      const room = { id: randomUUID(), name, createdAt: new Date().toISOString(), role: 'Owner' };
      this.rooms.set(room.id, room);
      return send(201, room);
    }
    const room = this.rooms.get(id);
    if (!isMembers) {
      if (!room) return send(404);
      if (req.method === 'PATCH') {
        const name = typeof body?.name === 'string' ? body.name.trim() : '';
        if (name.length < 1 || name.length > 120) return invalid();
        room.name = name;
        return send(200, room);
      }
      if (req.method === 'DELETE') {
        for (const board of this.boards.values()) {
          if (board.roomId === id) board.roomId = null;
        }
        this.rooms.delete(id);
        return send(204);
      }
      return send(405);
    }

    const list = this.roomMembers.get(id);
    if (!list) return send(404);
    if (req.method === 'GET' && !userId) return send(200, list);
    if (req.method === 'POST' && !userId) {
      const member = {
        userId: randomUUID(),
        displayName: body.email,
        email: body.email,
        role: body.role,
      };
      list.push(member);
      return send(201, member);
    }
    const member = list.find((m) => m.userId === userId);
    if (!member) return send(404);
    if (req.method === 'PATCH') {
      member.role = body.role;
      return send(200, member);
    }
    if (req.method === 'DELETE') {
      list.splice(list.indexOf(member), 1);
      return send(204);
    }
    return send(405);
  }
}
