import { Readable } from 'node:stream';
import type { ReadableStream as NodeReadableStream } from 'node:stream/web';
import { REQUEST_ID_HEADER, currentRequestId } from '@elysion/node-logging';
import type { BoardRole } from '@elysion/shared-types';
import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  PayloadTooLargeException,
  UnauthorizedException,
  UnsupportedMediaTypeException,
} from '@nestjs/common';

/** Base URL of the business backend, e.g. `http://localhost:5174`. */
export const BUSINESS_BACKEND_URL = Symbol('BUSINESS_BACKEND_URL');

/** A board as the business backend's Board API returns it. */
export interface Board {
  id: string;
  name: string;
  createdAt: string;
  /** The room the board is in, or null (ADR 0019). */
  roomId: string | null;
  /** When the board's preview picture was stored, or null when it has none (#729); `hasThumbnail` says the same. */
  thumbnailUpdatedAt?: string | null;
  hasThumbnail?: boolean;
}

/** A room as the business backend's room API returns it: `role` is the caller's role in it. */
export interface Room {
  id: string;
  name: string;
  createdAt: string;
  role: 'Owner' | 'Editor' | 'Viewer';
}

/** A template in the list of the backend's template catalog: no scene. */
export interface TemplateSummary {
  id: string;
  name: string;
  description: string;
  isBuiltIn: boolean;
  createdAt: string;
}

/** One template with its scene, the text of an `.excalidraw` file. */
export interface Template extends TemplateSummary {
  scene: string;
}

/** A member of a board or of a room, as the business backend's member APIs return it. */
export interface BoardMember {
  userId: string;
  displayName: string;
  email: string | null;
  role: 'Owner' | 'Editor' | 'Viewer';
}

const TIMEOUT_MS = 5000;
/** A file moves as one stream, so it gets longer than a JSON call: 10 MiB over a slow link. */
const FILE_TIMEOUT_MS = 60_000;

/** A file of a board as the business backend streams it: the headers worth passing on, and the bytes. */
export interface BackendFile {
  headers: Record<string, string>;
  stream: Readable;
}

/** What the browser needs to cache and show a file safely; everything else of the backend's answer stays here. */
const FILE_RESPONSE_HEADERS = [
  'content-type',
  'content-length',
  'cache-control',
  'etag',
  'x-content-type-options',
  'content-security-policy',
];

/**
 * Talks to the business backend's Board API on behalf of the signed-in user: every call carries the user's
 * access token, and the backend decides what that user may do. Its failures become the HTTP errors the BFF
 * answers with: 401, 403 and 404 stay as they are (a board the user has no role on is a 404 there, by design), a
 * rejected name stays 400 (with the backend's message), and anything else, including an unreachable backend,
 * is a 502.
 */
@Injectable()
export class BusinessBackendClient {
  constructor(@Inject(BUSINESS_BACKEND_URL) private readonly baseUrl: string) {}

  listBoards(token: string): Promise<Board[]> {
    return this.request<Board[]>(token, 'GET', '/boards');
  }

  getBoard(token: string, id: string): Promise<Board> {
    return this.request<Board>(token, 'GET', `/boards/${id}`);
  }

  createBoard(token: string, name: string): Promise<Board> {
    return this.request<Board>(token, 'POST', '/boards', { name });
  }

  renameBoard(token: string, id: string, name: string): Promise<Board> {
    return this.request<Board>(token, 'PATCH', `/boards/${id}`, { name });
  }

  duplicateBoard(token: string, id: string): Promise<Board> {
    return this.request<Board>(token, 'POST', `/boards/${id}/duplicate`);
  }

  /** Puts a board in a room, or takes it out of its room (`roomId: null`). */
  moveBoard(token: string, id: string, roomId: string | null): Promise<Board> {
    return this.request<Board>(token, 'PUT', `/boards/${id}/room`, { roomId });
  }

  listRooms(token: string): Promise<Room[]> {
    return this.request<Room[]>(token, 'GET', '/rooms');
  }

  createRoom(token: string, name: string): Promise<Room> {
    return this.request<Room>(token, 'POST', '/rooms', { name });
  }

  renameRoom(token: string, id: string, name: string): Promise<Room> {
    return this.request<Room>(token, 'PATCH', `/rooms/${id}`, { name });
  }

  async deleteRoom(token: string, id: string): Promise<void> {
    await this.request<void>(token, 'DELETE', `/rooms/${id}`);
  }

  listRoomMembers(token: string, roomId: string): Promise<BoardMember[]> {
    return this.request<BoardMember[]>(token, 'GET', `/rooms/${roomId}/members`);
  }

  addRoomMember(token: string, roomId: string, email: string, role: string): Promise<BoardMember> {
    return this.request<BoardMember>(token, 'POST', `/rooms/${roomId}/members`, { email, role });
  }

  changeRoomMemberRole(
    token: string,
    roomId: string,
    userId: string,
    role: string,
  ): Promise<BoardMember> {
    return this.request<BoardMember>(token, 'PATCH', `/rooms/${roomId}/members/${userId}`, {
      role,
    });
  }

  async removeRoomMember(token: string, roomId: string, userId: string): Promise<void> {
    await this.request<void>(token, 'DELETE', `/rooms/${roomId}/members/${userId}`);
  }

  listTemplates(token: string): Promise<TemplateSummary[]> {
    return this.request<TemplateSummary[]>(token, 'GET', '/templates');
  }

  getTemplate(token: string, id: string): Promise<Template> {
    return this.request<Template>(token, 'GET', `/templates/${id}`);
  }

  createTemplate(
    token: string,
    template: { name?: unknown; description?: unknown; scene?: unknown },
  ): Promise<Template> {
    return this.request<Template>(token, 'POST', '/templates', template);
  }

  async deleteTemplate(token: string, id: string): Promise<void> {
    await this.request<void>(token, 'DELETE', `/templates/${id}`);
  }

  listMembers(token: string, boardId: string): Promise<BoardMember[]> {
    return this.request<BoardMember[]>(token, 'GET', `/boards/${boardId}/members`);
  }

  addMember(token: string, boardId: string, email: string, role: string): Promise<BoardMember> {
    return this.request<BoardMember>(token, 'POST', `/boards/${boardId}/members`, { email, role });
  }

  changeMemberRole(
    token: string,
    boardId: string,
    userId: string,
    role: string,
  ): Promise<BoardMember> {
    return this.request<BoardMember>(token, 'PATCH', `/boards/${boardId}/members/${userId}`, {
      role,
    });
  }

  async removeMember(token: string, boardId: string, userId: string): Promise<void> {
    await this.request<void>(token, 'DELETE', `/boards/${boardId}/members/${userId}`);
  }

  /**
   * The caller's role on a board, or null when they have none: not a member, or no such board (the backend
   * answers 404 for both, so that board ids cannot be probed).
   */
  async getMyRole(token: string, boardId: string): Promise<BoardRole | null> {
    try {
      const membership = await this.request<{ role: string }>(
        token,
        'GET',
        `/boards/${boardId}/membership/me`,
      );
      return toBoardRole(membership.role);
    } catch (error) {
      if (error instanceof NotFoundException) {
        return null;
      }
      throw error;
    }
  }

  /**
   * Streams a file to the backend without holding it: the request body is piped, so the BFF's memory does not grow
   * with the file. `length` is the request's own `Content-Length`; the backend refuses a body over its limit.
   */
  putFile(
    token: string,
    boardId: string,
    fileId: string,
    file: { contentType: string; length: number; body: Readable },
  ): Promise<void> {
    return this.putStream(token, `/boards/${boardId}/files/${fileId}`, file);
  }

  /** The preview picture of a board (#729), streamed like a file. */
  putThumbnail(
    token: string,
    boardId: string,
    file: { contentType: string; length: number; body: Readable },
  ): Promise<void> {
    return this.putStream(token, `/boards/${boardId}/thumbnail`, file);
  }

  private async putStream(
    token: string,
    path: string,
    file: { contentType: string; length: number; body: Readable },
  ): Promise<void> {
    const response = await this.fetchBackend(path, {
      method: 'PUT',
      headers: {
        ...this.headers(token),
        'content-type': file.contentType,
        'content-length': String(file.length),
      },
      body: Readable.toWeb(file.body) as ReadableStream,
      duplex: 'half',
      signal: AbortSignal.timeout(FILE_TIMEOUT_MS),
    } as RequestInit);
    if (!response.ok) {
      await this.fail(response);
    }
    await response.body?.cancel();
  }

  /**
   * The preview picture of a board, or `'not-modified'` when the caller's copy (`ifNoneMatch`, the ETag it has) is the current
   * one: the backend answers 304 without reading the picture.
   */
  async getThumbnail(
    token: string,
    boardId: string,
    ifNoneMatch?: string,
  ): Promise<BackendFile | 'not-modified'> {
    const response = await this.fetchBackend(`/boards/${boardId}/thumbnail`, {
      method: 'GET',
      headers: {
        ...this.headers(token),
        ...(ifNoneMatch === undefined ? {} : { 'if-none-match': ifNoneMatch }),
      },
      signal: AbortSignal.timeout(FILE_TIMEOUT_MS),
    });
    if (response.status === 304) {
      return 'not-modified';
    }
    return this.fileOf(response);
  }

  /** A file of a board; the body is a stream, to be piped to the caller and not read into memory. */
  async getFile(token: string, boardId: string, fileId: string): Promise<BackendFile> {
    const response = await this.fetchBackend(`/boards/${boardId}/files/${fileId}`, {
      method: 'GET',
      headers: this.headers(token),
      signal: AbortSignal.timeout(FILE_TIMEOUT_MS),
    });
    return this.fileOf(response);
  }

  private async fileOf(response: Response): Promise<BackendFile> {
    if (!response.ok) {
      await this.fail(response);
    }
    const headers: Record<string, string> = {};
    for (const name of FILE_RESPONSE_HEADERS) {
      const value = response.headers.get(name);
      if (value !== null) headers[name] = value;
    }
    return {
      headers,
      stream:
        response.body === null
          ? Readable.from([])
          : Readable.fromWeb(response.body as unknown as NodeReadableStream),
    };
  }

  async deleteBoard(token: string, id: string): Promise<void> {
    await this.request<void>(token, 'DELETE', `/boards/${id}`);
  }

  /** The headers of every call: the caller's token and the id of the request being handled, so the backend's lines carry it (ADR 0025). */
  private headers(token: string): Record<string, string> {
    const requestId = currentRequestId();
    return {
      authorization: `Bearer ${token}`,
      ...(requestId === undefined ? {} : { [REQUEST_ID_HEADER]: requestId }),
    };
  }

  private async fetchBackend(path: string, init: RequestInit): Promise<Response> {
    try {
      return await fetch(new URL(path, this.baseUrl), init);
    } catch {
      throw new BadGatewayException('The business backend is not reachable.');
    }
  }

  private async request<T>(
    token: string,
    method: string,
    path: string,
    body?: unknown,
  ): Promise<T> {
    const response = await this.fetchBackend(path, {
      method,
      headers: {
        ...this.headers(token),
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    if (response.ok) {
      return (response.status === 204 ? undefined : await response.json()) as T;
    }
    return this.fail(response);
  }

  /** The HTTP error the BFF answers with for a failed call of the backend. */
  private async fail(response: Response): Promise<never> {
    if (response.status === 401) {
      throw new UnauthorizedException();
    }
    if (response.status === 403) {
      throw new ForbiddenException();
    }
    if (response.status === 404) {
      // A board or room that is not visible has no body; the member and room APIs say why (an unknown email, not a member, no such room).
      throw new NotFoundException(await problemDetail(response));
    }
    if (response.status === 409) {
      throw new ConflictException(await problemDetail(response));
    }
    if (response.status === 413) {
      throw new PayloadTooLargeException(await problemDetail(response));
    }
    if (response.status === 415) {
      throw new UnsupportedMediaTypeException();
    }
    if (response.status === 400) {
      throw new BadRequestException(await validationMessage(response));
    }
    throw new BadGatewayException(`The business backend answered ${response.status}.`);
  }
}

/** The backend names roles `Owner`, `Editor`, `Viewer`; the token carries them lower-case. An unknown one is an error, never a default. */
function toBoardRole(role: string): BoardRole {
  const lower = role.toLowerCase();
  if (lower === 'owner' || lower === 'editor' || lower === 'viewer') {
    return lower;
  }
  throw new BadGatewayException(`The business backend answered an unknown role "${role}".`);
}

/** The `detail` of an ASP.NET problem-details body, or `undefined` when there is none. */
async function problemDetail(response: Response): Promise<string | undefined> {
  try {
    const problem = (await response.json()) as { detail?: unknown };
    return typeof problem.detail === 'string' ? problem.detail : undefined;
  } catch {
    return undefined;
  }
}

/** The messages of an ASP.NET problem-details body, or a generic text if it has none. */
async function validationMessage(response: Response): Promise<string> {
  try {
    const problem = (await response.json()) as {
      errors?: Record<string, string[]>;
      title?: string;
    };
    const messages = Object.values(problem.errors ?? {}).flat();
    return messages.length > 0 ? messages.join(' ') : (problem.title ?? 'Invalid request.');
  } catch {
    return 'Invalid request.';
  }
}
