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

interface FakeWebhook {
  id: string;
  boardId: string | null;
  url: string;
  events: string[];
  enabled: boolean;
  disabledAt: string | null;
  disabledReason: string | null;
  createdAt: string;
  secretPrefix: string;
  secret: string;
}

interface FakeDelivery {
  id: string;
  eventId: string;
  eventType: string;
  status: 'pending' | 'succeeded' | 'failed';
  attempts: number;
  responseStatus: number | null;
  durationMs: number | null;
  error: string | null;
  createdAt: string;
  lastAttemptAt: string | null;
  nextAttemptAt: string | null;
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
  /** The people the search route serves (`GET /users?query=`, #663), and the last query it saw. */
  users: Array<{ id: string; displayName: string; email: string | null }> = [];
  lastUserSearch: string | null = null;
  /** The groups the group routes serve (#647), and the caller's own (`GET /me/groups`). */
  readonly groups = new Map<string, { id: string; name: string; source: string }>();
  readonly myGroups = new Set<string>();
  /** The role of a group per room id, for `/rooms/:id/groups`. */
  readonly roomGroups = new Map<string, Map<string, string>>();
  /** The last request to a group route: method, path with its query and the parsed body. */
  lastGroupRequest: { method: string; path: string; body: unknown } | null = null;
  /** The last request for a search or a per-person state (#730): method and path with its query. */
  lastStateRequest: { method: string; path: string } | null = null;
  /** The last invitation request (#734): method, path and parsed body. */
  lastInvitationRequest: { method: string; path: string; body: unknown } | null = null;
  /** What the invitation routes answer; a test sets it. `body` undefined is an empty answer. */
  invitationAnswer: { status: number; body?: unknown } = { status: 200, body: undefined };
  /** The last voting request (#732): method, path and parsed body. */
  lastVotingRequest: { method: string; path: string; body: unknown } | null = null;
  /** What the voting routes answer; a test sets it. `body` undefined is an empty answer (204 for "none"). */
  votingAnswer: { status: number; body?: unknown } = { status: 200, body: undefined };
  /** The last request to a snapshot route (#846): method, path and parsed body. */
  lastSnapshotRequest: { method: string; path: string; body: unknown } | null = null;
  /** What the snapshot routes answer; a test sets it. `body` undefined is an empty answer. */
  snapshotAnswer: { status: number; body?: unknown } = { status: 200, body: undefined };
  /** The bytes the document route of a snapshot serves. */
  snapshotDocument = Buffer.from([1, 2, 3]);
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
  /** The preview pictures of boards, by board id, with the version the ETag is made of (#729). */
  readonly thumbnails = new Map<string, { bytes: Buffer; version: number }>();
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
  /** The last `/admin...` request (#656): what the BFF passed on, and what the fake answers with. */
  lastAdminRequest: { method: string; path: string; body: unknown } | null = null;
  adminAnswer: { status: number; body?: unknown } = { status: 200, body: { ok: true } };
  /**
   * What `GET /me/credential` answers per bearer token (ADR 0033, #851): a credential (200) or a status; a token that is not in
   * here is unknown (401). `credentialCalls` counts the calls, so a test sees the BFF's cache.
   */
  readonly credentials = new Map<string, { status: number; body?: unknown }>();
  credentialCalls = 0;
  /**
   * Tokens the backend refuses (`401`) on every route but `/me/credential`: a revoke the BFF's 30-second cache has not seen yet,
   * which the backend's own lookup sees (ADR 0033, #852).
   */
  readonly revoked = new Set<string>();
  /** The stored Yjs state per board id, served by `GET /boards/:id/document` (#852); a known board without one answers 204. */
  readonly documents = new Map<string, Uint8Array>();
  /** The last `/access-tokens` request (#851): method, path and parsed body; and what the fake answers with. */
  lastAccessTokenRequest: { method: string; path: string; body: unknown } | null = null;
  accessTokenAnswer: { status: number; body?: unknown } = { status: 200, body: [] };
  /**
   * The webhooks of the boards (#853), by id, as the backend keeps them (with the secret, which only the answer to the creation
   * carries), and their deliveries. A board's routes answer 404 for a board that is not in `boards` and 403 when `roles` gives the
   * caller a role below Owner, as the backend's policy does.
   */
  readonly webhooks = new Map<string, FakeWebhook>();
  readonly webhookDeliveries = new Map<string, FakeDelivery[]>();
  /** The last request to a board's webhook route: method, path and parsed body. */
  lastWebhookRequest: { method: string; path: string; body: unknown } | null = null;
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

  /** A board's webhooks, as `WebhookEndpoints` of the business backend answers them (#853). */
  async #handleWebhooks(
    req: IncomingMessage,
    route: RegExpExecArray,
    send: (status: number, body?: unknown) => void,
  ): Promise<void> {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const body = chunks.length > 0 ? JSON.parse(Buffer.concat(chunks).toString()) : undefined;
    this.lastWebhookRequest = { method: req.method ?? '', path: req.url ?? '', body };
    const [, boardId, webhookId, action, deliveryId] = route;
    if (!this.boards.has(boardId!)) return send(404);
    const role = this.roles.get(boardId!);
    if (role !== undefined && role !== 'Owner') return send(403);
    const shown = ({ secret: _secret, ...webhook }: FakeWebhook) => webhook;
    const notFound = () => send(404, { status: 404, detail: 'There is no such webhook.' });
    if (webhookId === undefined) {
      if (req.method === 'GET') {
        return send(
          200,
          [...this.webhooks.values()].filter((w) => w.boardId === boardId).map(shown),
        );
      }
      if (typeof body?.url !== 'string' || !body.url.startsWith('https://')) {
        return send(400, { title: 'Invalid', errors: { url: ['Only https URLs are allowed.'] } });
      }
      const secret = `whsec_${'s'.repeat(43)}`;
      const webhook: FakeWebhook = {
        id: randomUUID(),
        boardId: boardId!,
        url: body.url,
        events: body.events ?? [],
        enabled: true,
        disabledAt: null,
        disabledReason: null,
        createdAt: new Date().toISOString(),
        secretPrefix: secret.slice(0, 10),
        secret,
      };
      this.webhooks.set(webhook.id, webhook);
      this.webhookDeliveries.set(webhook.id, []);
      return send(201, webhook);
    }
    const webhook = this.webhooks.get(webhookId);
    if (webhook === undefined || webhook.boardId !== boardId) return notFound();
    const deliveries = this.webhookDeliveries.get(webhook.id)!;
    const delivery = (eventType: string, eventId = randomUUID()): FakeDelivery => ({
      id: randomUUID(),
      eventId,
      eventType,
      status: 'pending',
      attempts: 0,
      responseStatus: null,
      durationMs: null,
      error: null,
      createdAt: new Date().toISOString(),
      lastAttemptAt: null,
      nextAttemptAt: new Date().toISOString(),
    });
    if (action === 'test') {
      const made = delivery('webhook.test');
      deliveries.unshift(made);
      return send(202, made);
    }
    if (action === 'deliveries' && deliveryId !== undefined) {
      const original = deliveries.find((d) => d.id === deliveryId);
      if (original === undefined)
        return send(404, { status: 404, detail: 'There is no such delivery.' });
      if (original.status === 'pending') {
        return send(409, { status: 409, detail: 'This delivery is still being sent.' });
      }
      const again = delivery(original.eventType, original.eventId);
      deliveries.unshift(again);
      return send(202, again);
    }
    if (action === 'deliveries') return send(200, deliveries);
    if (req.method === 'GET') return send(200, shown(webhook));
    if (req.method === 'DELETE') {
      this.webhooks.delete(webhook.id);
      return send(204);
    }
    if (body?.url !== undefined) webhook.url = body.url;
    if (body?.events !== undefined) webhook.events = body.events;
    if (body?.enabled === false) {
      webhook.enabled = false;
      webhook.disabledAt = new Date().toISOString();
      webhook.disabledReason = 'Switched off by a person.';
    }
    if (body?.enabled === true) {
      webhook.enabled = true;
      webhook.disabledAt = null;
      webhook.disabledReason = null;
    }
    return send(200, shown(webhook));
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
    const bearerToken = /^Bearer (\S+)$/.exec(req.headers.authorization ?? '')?.[1];
    if (
      bearerToken !== undefined &&
      this.revoked.has(bearerToken) &&
      req.url !== '/me/credential'
    ) {
      return send(401);
    }
    const webhookRoute =
      /^\/boards\/([^/]+)\/webhooks(?:\/([^/]+)(?:\/(test|deliveries)(?:\/([^/]+)\/redeliver)?)?)?$/.exec(
        req.url ?? '',
      );
    if (webhookRoute) return this.#handleWebhooks(req, webhookRoute, send);
    const documentRoute = /^\/boards\/([^/]+)\/document$/.exec(req.url ?? '');
    if (documentRoute && req.method === 'GET') {
      if (!this.boards.has(documentRoute[1]!)) return send(404);
      const state = this.documents.get(documentRoute[1]!);
      if (state === undefined) return send(204);
      res.writeHead(200, { 'content-type': 'application/octet-stream', etag: '"1"' });
      return void res.end(Buffer.from(state));
    }
    if (req.url === '/me/credential' && req.method === 'GET') {
      this.credentialCalls += 1;
      const token = /^Bearer (\S+)$/.exec(req.headers.authorization ?? '')?.[1] ?? '';
      const answer = this.credentials.get(token) ?? { status: 401 };
      return send(answer.status, answer.body);
    }
    if (/^\/access-tokens(?:\/[^/]+)?$/.test(req.url ?? '')) {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(chunk as Buffer);
      const body = chunks.length > 0 ? JSON.parse(Buffer.concat(chunks).toString()) : undefined;
      this.lastAccessTokenRequest = { method: req.method ?? '', path: req.url ?? '', body };
      const answer = this.accessTokenAnswer;
      return send(answer.status, answer.body);
    }
    if (
      /^\/admin(?:[/?]|$)/.test(req.url ?? '') ||
      /^\/(?:boards|rooms)\/[^/]+\/history$/.test(req.url ?? '')
    ) {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(chunk as Buffer);
      const body = chunks.length > 0 ? JSON.parse(Buffer.concat(chunks).toString()) : undefined;
      this.lastAdminRequest = { method: req.method ?? '', path: req.url ?? '', body };
      const answer = this.adminAnswer;
      return send(answer.status, answer.body);
    }
    const groupRoute = /^\/(groups|me\/groups|rooms\/([^/]+)\/groups(?:\/([^/]+))?)(?:\?.*)?$/.exec(
      req.url ?? '',
    );
    if (groupRoute) return this.#handleGroups(req, res, groupRoute);
    const roomRoute = /^\/rooms(?:\/([^/]+?)(?:\/members(?:\/([^/]+))?)?)?$/.exec(req.url ?? '');
    const moveRoute = /^\/boards\/([^/]+)\/room$/.exec(req.url ?? '');
    if (roomRoute || moveRoute) return this.#handleRoom(req, res, roomRoute, moveRoute);
    if ((req.url ?? '').startsWith('/users?')) {
      const query = (new URL(req.url!, 'http://x').searchParams.get('query') ?? '').toLowerCase();
      this.lastUserSearch = query;
      if (query.length < 2) return send(400, { title: 'Bad query' });
      return send(
        200,
        this.users.filter(
          (u) => u.displayName.toLowerCase().includes(query) || (u.email ?? '').includes(query),
        ),
      );
    }
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
        const person = body.userId ? this.users.find((u) => u.id === body.userId) : undefined;
        const member = {
          userId: person?.id ?? randomUUID(),
          displayName: person?.displayName ?? body.email,
          email: person?.email ?? body.email,
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
    const stateRoute = /^\/boards\/([^/?]+)\/(open|favorite)$/.exec(req.url ?? '');
    if (stateRoute) {
      this.lastStateRequest = { method: req.method ?? '', path: req.url ?? '' };
      return this.boards.has(stateRoute[1]!) ? send(204) : send(404);
    }
    if ((req.url ?? '').startsWith('/boards?')) {
      this.lastStateRequest = { method: req.method ?? '', path: req.url ?? '' };
      return send(200, [...this.boards.values()].reverse());
    }
    const invitationRoute = /^\/(?:boards|rooms)\/[^/]+\/invitations(?:\/|$)|^\/invitations\//.exec(
      req.url ?? '',
    );
    if (invitationRoute) {
      const parts: Buffer[] = [];
      for await (const chunk of req) parts.push(chunk as Buffer);
      const text = Buffer.concat(parts).toString();
      this.lastInvitationRequest = {
        method: req.method ?? '',
        path: req.url ?? '',
        body: text ? JSON.parse(text) : null,
      };
      const { status, body } = this.invitationAnswer;
      return body === undefined ? send(status) : send(status, body);
    }
    const snapshotRoute =
      /^\/boards\/([^/]+)\/snapshots(?:\/([^/]+)(\/document|\/restore|\/copy)?)?$/.exec(
        req.url ?? '',
      );
    if (snapshotRoute) {
      const parts: Buffer[] = [];
      for await (const chunk of req) parts.push(chunk as Buffer);
      const text = Buffer.concat(parts).toString();
      this.lastSnapshotRequest = {
        method: req.method ?? '',
        path: req.url ?? '',
        body: text ? JSON.parse(text) : null,
      };
      if (snapshotRoute[3] === '/document' && this.snapshotAnswer.status === 200) {
        res.writeHead(200, {
          'content-type': 'application/octet-stream',
          'content-length': this.snapshotDocument.length,
          'x-internal': 'must-not-be-passed-on',
        });
        return void res.end(this.snapshotDocument);
      }
      const { status, body } = this.snapshotAnswer;
      return body === undefined ? send(status) : send(status, body);
    }
    const votingRoute = /^\/boards\/([^/]+)\/votings?(?:\/|$)/.exec(req.url ?? '');
    if (votingRoute) {
      const parts: Buffer[] = [];
      for await (const chunk of req) parts.push(chunk as Buffer);
      const text = Buffer.concat(parts).toString();
      this.lastVotingRequest = {
        method: req.method ?? '',
        path: req.url ?? '',
        body: text ? JSON.parse(text) : null,
      };
      const { status, body } = this.votingAnswer;
      return body === undefined ? send(status) : send(status, body);
    }
    const thumbnailRoute = /^\/boards\/([^/]+)\/thumbnail$/.exec(req.url ?? '');
    if (thumbnailRoute) {
      const id = thumbnailRoute[1]!;
      if (req.method === 'PUT') {
        const parts: Buffer[] = [];
        for await (const chunk of req) parts.push(chunk as Buffer);
        const version = (this.thumbnails.get(id)?.version ?? 0) + 1;
        this.thumbnails.set(id, { bytes: Buffer.concat(parts), version });
        return send(204);
      }
      const picture = this.thumbnails.get(id);
      if (!picture) return send(404);
      const etag = `"${picture.version}"`;
      if (req.headers['if-none-match'] === etag) return send(304);
      res.writeHead(200, {
        'content-type': 'image/png',
        'content-length': picture.bytes.length,
        'cache-control': 'private, no-cache',
        etag,
        'x-internal': 'must-not-be-passed-on',
      });
      return void res.end(picture.bytes);
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
  async #handleGroups(
    req: IncomingMessage,
    res: import('node:http').ServerResponse,
    route: RegExpExecArray,
  ): Promise<void> {
    const send = (status: number, body?: unknown) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(body === undefined ? undefined : JSON.stringify(body));
    };
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const body = chunks.length > 0 ? JSON.parse(Buffer.concat(chunks).toString()) : null;
    this.lastGroupRequest = { method: req.method ?? '', path: req.url ?? '', body };
    const [, what, roomId, groupId] = route;
    if (what === 'groups') {
      const query = new URL(req.url ?? '', 'http://x').searchParams.get('query')?.trim() ?? '';
      if (query.length < 2) return send(400, { title: 'One or more validation errors occurred.' });
      return send(
        200,
        [...this.groups.values()].filter((g) => g.name.toLowerCase().includes(query.toLowerCase())),
      );
    }
    if (what === 'me/groups') {
      return send(
        200,
        [...this.groups.values()].filter((g) => this.myGroups.has(g.id)),
      );
    }
    const roles = this.roomGroups.get(roomId!);
    if (!this.rooms.has(roomId!)) return send(404);
    if (req.method === 'GET' && !groupId) {
      return send(
        200,
        [...(roles ?? new Map()).entries()].map(([id, role]) => ({
          groupId: id,
          name: this.groups.get(id)?.name ?? id,
          role,
        })),
      );
    }
    const group = this.groups.get(groupId!);
    if (!group) return send(404);
    if (req.method === 'PUT') {
      if (!['Owner', 'Editor', 'Viewer'].includes(body?.role)) return send(400);
      const map = roles ?? new Map<string, string>();
      map.set(group.id, body.role);
      this.roomGroups.set(roomId!, map);
      return send(200, { groupId: group.id, name: group.name, role: body.role });
    }
    if (req.method === 'DELETE') {
      return roles?.delete(group.id) ? send(204) : send(404);
    }
    return send(405);
  }

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
