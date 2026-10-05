import { createServer, IncomingMessage, Server } from 'node:http';
import { AddressInfo } from 'node:net';
import { randomUUID } from 'node:crypto';

interface FakeBoard {
  id: string;
  name: string;
  createdAt: string;
}

/**
 * A stand-in for the business backend's Board API (apps/business-backend, `BoardsController`):
 * same routes and status codes, boards kept in memory. It counts the requests it receives so a test
 * can tell that the BFF answered without calling it.
 */
export class FakeBusinessBackend {
  readonly boards = new Map<string, FakeBoard>();
  requests = 0;
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
    const send = (status: number, body?: unknown) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(body === undefined ? undefined : JSON.stringify(body));
    };
    const match = /^\/boards(?:\/([^/]+))?$/.exec(req.url ?? '');
    if (!match) return send(404);
    const id = match[1];

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
      const board = { id: randomUUID(), name, createdAt: new Date().toISOString() };
      this.boards.set(board.id, board);
      return send(201, board);
    }
    const board = id ? this.boards.get(id) : undefined;
    if (id && !board) return send(404);
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
}
