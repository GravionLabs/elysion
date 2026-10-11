import { Readable } from 'node:stream';
import type { ReadableStream as NodeReadableStream } from 'node:stream/web';
import { REQUEST_ID_HEADER, currentRequestId } from '@elysion/node-logging';
import type { BoardRole } from '@elysion/shared-types';
import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  GoneException,
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
  /** When the caller last opened the board, or null (#730). */
  lastOpenedAt?: string | null;
  /** Whether the caller starred the board (#730). */
  isFavorite?: boolean;
}

/** A person in a voting: `id` is the identity-provider subject, the id the canvas knows (#732). */
export interface VotingPerson {
  id: string;
  name: string;
}

/**
 * A dot voting as the backend returns it to this caller (ADR 0029): the caller's own votes, never another person's targets
 * while it is open; `placed` (open) says how many votes each person has placed, `result` (closed) the votes per element.
 */
export interface Voting {
  id: string;
  name: string;
  votesPerPerson: number;
  status: 'open' | 'closed';
  named: boolean;
  startedBy: VotingPerson;
  startedAt: string;
  closedAt: string | null;
  myVotes: number;
  myElementVotes: Record<string, number>;
  placed?: Record<string, number>;
  result?: Array<{ elementId: string; count: number; voters?: VotingPerson[] }>;
}

/** What the caller sends to start a voting. */
export interface StartVotingInput {
  name?: string;
  votesPerPerson?: number;
  named?: boolean;
}

/** An active invitation link as the list shows it (#734): never the token. */
export interface Invitation {
  id: string;
  role: 'Editor' | 'Viewer';
  expiresAt: string;
  maxUses: number | null;
  uses: number;
  createdAt: string;
}

/** The answer to making a link: the one time the token is shown. */
export interface CreatedInvitation extends Invitation {
  token: string;
  url: string | null;
}

/** What the caller sends to make a link; the limits (1 to 720 hours, 1 to 1000 uses) belong to the business backend, which answers 400. */
export interface CreateInvitationInput {
  role?: string;
  expiresInHours?: number;
  maxUses?: number;
}

/** What following a link did: the board or room and the role the person has there now. */
export interface AcceptedInvitation {
  kind: 'board' | 'room';
  id: string;
  role: 'Owner' | 'Editor' | 'Viewer';
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

/** A group as the business backend returns it: no members; `source` says whether the identity provider owns them (ADR 0027). */
export interface Group {
  id: string;
  name: string;
  source: 'Local' | 'IdentityProvider';
}

/** A group's role in a room. */
/** A person found by the people search: enough to recognise them and to add them as a member. */
export interface DirectoryUser {
  id: string;
  displayName: string;
  email: string | null;
}

export interface RoomGroup {
  groupId: string;
  name: string;
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

  /** The caller's boards; `query` keeps those whose name contains it (ignoring case). */
  listBoards(token: string, query?: string): Promise<Board[]> {
    const search = query ? `?query=${encodeURIComponent(query)}` : '';
    return this.request<Board[]>(token, 'GET', `/boards${search}`);
  }

  /** Records that the caller opened the board (the backend writes at most every few minutes). */
  openBoard(token: string, id: string): Promise<void> {
    return this.request<void>(token, 'POST', `/boards/${id}/open`);
  }

  /** Stars the board for the caller, or takes the star away. */
  setFavorite(token: string, id: string, favorite: boolean): Promise<void> {
    return this.request<void>(token, favorite ? 'PUT' : 'DELETE', `/boards/${id}/favorite`);
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

  /** The board's current voting (the open one, else the last closed) as the caller sees it, or `null` when it has none. */
  async getVoting(token: string, boardId: string): Promise<Voting | null> {
    return (
      (await this.request<Voting | undefined>(token, 'GET', `/boards/${boardId}/voting`)) ?? null
    );
  }

  startVoting(token: string, boardId: string, input: StartVotingInput): Promise<Voting> {
    return this.request<Voting>(token, 'POST', `/boards/${boardId}/votings`, input);
  }

  castVote(token: string, boardId: string, votingId: string, elementId: string): Promise<Voting> {
    return this.request<Voting>(token, 'POST', `/boards/${boardId}/votings/${votingId}/votes`, {
      elementId,
    });
  }

  /** Takes back one of the caller's votes on an element; the voting after it, or `null` when they had none there. */
  async retractVote(
    token: string,
    boardId: string,
    votingId: string,
    elementId: string,
  ): Promise<Voting | null> {
    return (
      (await this.request<Voting | undefined>(
        token,
        'DELETE',
        `/boards/${boardId}/votings/${votingId}/votes/${encodeURIComponent(elementId)}`,
      )) ?? null
    );
  }

  closeVoting(token: string, boardId: string, votingId: string): Promise<Voting> {
    return this.request<Voting>(token, 'POST', `/boards/${boardId}/votings/${votingId}/close`);
  }

  /** Removes the board's closed votings; an open one stays. */
  async clearVotings(token: string, boardId: string): Promise<void> {
    await this.request<void>(token, 'DELETE', `/boards/${boardId}/votings`);
  }

  /** Puts a board in a room, or takes it out of its room (`roomId: null`). */
  moveBoard(token: string, id: string, roomId: string | null): Promise<Board> {
    return this.request<Board>(token, 'PUT', `/boards/${id}/room`, { roomId });
  }

  /** The invitation links of a board (`scope` `boards`) or room (`rooms`) that still work. */
  listInvitations(token: string, scope: 'boards' | 'rooms', id: string): Promise<Invitation[]> {
    return this.request<Invitation[]>(token, 'GET', `/${scope}/${id}/invitations`);
  }

  createInvitation(
    token: string,
    scope: 'boards' | 'rooms',
    id: string,
    input: CreateInvitationInput,
  ): Promise<CreatedInvitation> {
    return this.request<CreatedInvitation>(token, 'POST', `/${scope}/${id}/invitations`, input);
  }

  revokeInvitation(
    token: string,
    scope: 'boards' | 'rooms',
    id: string,
    invitationId: string,
  ): Promise<void> {
    return this.request<void>(token, 'DELETE', `/${scope}/${id}/invitations/${invitationId}`);
  }

  /** Follows a link as the caller. The link's token is in the path and never in a log: the request line has the route pattern only. */
  acceptInvitation(token: string, invitationToken: string): Promise<AcceptedInvitation> {
    return this.request<AcceptedInvitation>(
      token,
      'POST',
      `/invitations/${encodeURIComponent(invitationToken)}/accept`,
    );
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

  addRoomMember(
    token: string,
    roomId: string,
    who: { email?: string; userId?: string },
    role: string,
  ): Promise<BoardMember> {
    return this.request<BoardMember>(token, 'POST', `/rooms/${roomId}/members`, { ...who, role });
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

  /** The groups whose name contains `query` (at least two characters; the backend answers 400 otherwise). */
  searchGroups(token: string, query: string): Promise<Group[]> {
    return this.request<Group[]>(token, 'GET', `/groups?query=${encodeURIComponent(query)}`);
  }

  /** The groups the caller is in. */
  listMyGroups(token: string): Promise<Group[]> {
    return this.request<Group[]>(token, 'GET', '/me/groups');
  }

  listRoomGroups(token: string, roomId: string): Promise<RoomGroup[]> {
    return this.request<RoomGroup[]>(token, 'GET', `/rooms/${roomId}/groups`);
  }

  setRoomGroupRole(
    token: string,
    roomId: string,
    groupId: string,
    role: string,
  ): Promise<RoomGroup> {
    return this.request<RoomGroup>(token, 'PUT', `/rooms/${roomId}/groups/${groupId}`, { role });
  }

  async removeRoomGroup(token: string, roomId: string, groupId: string): Promise<void> {
    await this.request<void>(token, 'DELETE', `/rooms/${roomId}/groups/${groupId}`);
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

  addMember(
    token: string,
    boardId: string,
    who: { email?: string; userId?: string },
    role: string,
  ): Promise<BoardMember> {
    return this.request<BoardMember>(token, 'POST', `/boards/${boardId}/members`, { ...who, role });
  }

  /** People whose name or email contains the text (2 to 100 characters, at most 10 answers; the backend decides). */
  searchUsers(token: string, query: string): Promise<DirectoryUser[]> {
    return this.request<DirectoryUser[]>(token, 'GET', `/users?query=${encodeURIComponent(query)}`);
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

  // The administration area (ADR 0027, #656): one method per call, with a fixed path. The only variable parts are ids that passed
  // the UUID check in the controller (and are encoded anyway) and a query string made from numbers and one short text.

  adminStats(token: string): Promise<unknown> {
    return this.request<unknown>(token, 'GET', '/admin/stats');
  }

  adminListUsers(token: string, list: AdminList): Promise<unknown> {
    return this.request<unknown>(token, 'GET', `/admin/users${adminQuery(list)}`);
  }

  adminGetUser(token: string, id: string): Promise<unknown> {
    return this.request<unknown>(token, 'GET', `/admin/users/${encodeURIComponent(id)}`);
  }

  /** Deactivates a person (#668); the answer is their detail. */
  adminDeactivateUser(token: string, id: string): Promise<unknown> {
    return this.request<unknown>(
      token,
      'POST',
      `/admin/users/${encodeURIComponent(id)}/deactivate`,
    );
  }

  adminReactivateUser(token: string, id: string): Promise<unknown> {
    return this.request<unknown>(
      token,
      'POST',
      `/admin/users/${encodeURIComponent(id)}/reactivate`,
    );
  }

  /** Hands what a deactivated person owned over to another person (#668); the answer says how many boards and rooms moved. */
  adminTransferOwnership(token: string, fromUserId: string, toUserId: string): Promise<unknown> {
    return this.request<unknown>(token, 'POST', '/admin/boards/transfer', { fromUserId, toUserId });
  }

  adminListGroups(token: string, list: AdminList): Promise<unknown> {
    return this.request<unknown>(token, 'GET', `/admin/groups${adminQuery(list)}`);
  }

  adminCreateGroup(token: string, name: string): Promise<unknown> {
    return this.request<unknown>(token, 'POST', '/admin/groups', { name });
  }

  /** `externalId: null` unlinks the group, a string links it; a key that is left out is not sent. */
  adminPatchGroup(token: string, id: string, patch: AdminGroupPatch): Promise<unknown> {
    return this.request<unknown>(token, 'PATCH', `/admin/groups/${encodeURIComponent(id)}`, patch);
  }

  async adminDeleteGroup(token: string, id: string): Promise<void> {
    await this.request<void>(token, 'DELETE', `/admin/groups/${encodeURIComponent(id)}`);
  }

  adminListGroupMembers(token: string, id: string, list: AdminList): Promise<unknown> {
    return this.request<unknown>(
      token,
      'GET',
      `/admin/groups/${encodeURIComponent(id)}/members${adminQuery(list)}`,
    );
  }

  adminListGroupPending(token: string, id: string, list: AdminList): Promise<unknown> {
    return this.request<unknown>(
      token,
      'GET',
      `/admin/groups/${encodeURIComponent(id)}/pending${adminQuery(list)}`,
    );
  }

  adminGraphStatus(token: string): Promise<unknown> {
    return this.request<unknown>(token, 'GET', '/admin/graph');
  }

  async adminAddGroupMember(token: string, id: string, userId: string): Promise<void> {
    await this.request<void>(
      token,
      'PUT',
      `/admin/groups/${encodeURIComponent(id)}/members/${encodeURIComponent(userId)}`,
    );
  }

  async adminRemoveGroupMember(token: string, id: string, userId: string): Promise<void> {
    await this.request<void>(
      token,
      'DELETE',
      `/admin/groups/${encodeURIComponent(id)}/members/${encodeURIComponent(userId)}`,
    );
  }

  adminListRooms(token: string, list: AdminList): Promise<unknown> {
    return this.request<unknown>(token, 'GET', `/admin/rooms${adminQuery(list)}`);
  }

  /** The audit log of the instance (#669): filters checked by the controller, the path fixed. */
  adminListAudit(token: string, filter: AuditFilter): Promise<unknown> {
    const params = new URLSearchParams();
    if (filter.subject !== undefined) params.append('subject', filter.subject);
    if (filter.actor !== undefined) params.append('actor', filter.actor);
    if (filter.from !== undefined) params.append('from', filter.from);
    if (filter.to !== undefined) params.append('to', filter.to);
    if (filter.page !== undefined) params.append('page', String(filter.page));
    if (filter.pageSize !== undefined) params.append('pageSize', String(filter.pageSize));
    const text = params.toString();
    return this.request<unknown>(token, 'GET', `/admin/audit${text === '' ? '' : `?${text}`}`);
  }

  /** The last entries of the audit log about a board, for its owners (#669). */
  boardHistory(token: string, id: string): Promise<unknown> {
    return this.request<unknown>(token, 'GET', `/boards/${encodeURIComponent(id)}/history`);
  }

  /** The last entries of the audit log about a room, for its owners (#669). */
  roomHistory(token: string, id: string): Promise<unknown> {
    return this.request<unknown>(token, 'GET', `/rooms/${encodeURIComponent(id)}/history`);
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
      // A deactivated person's 403 says why (#668), so that the shell can show a page for it instead of an error.
      const code = await problemCode(response);
      throw code === ACCOUNT_DEACTIVATED
        ? new ForbiddenException({
            statusCode: 403,
            error: 'Forbidden',
            message: 'This account has been deactivated.',
            code,
          })
        : new ForbiddenException();
    }
    if (response.status === 404) {
      // A board or room that is not visible has no body; the member and room APIs say why (an unknown email, not a member, no such room).
      throw new NotFoundException(await problemDetail(response));
    }
    if (response.status === 409) {
      throw new ConflictException(await problemDetail(response));
    }
    if (response.status === 410) {
      // An invitation link that expired, was revoked or is used up (#734).
      throw new GoneException(await problemDetail(response));
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
/** The code an account that was deactivated gets with its 403 (the business backend's `account-deactivated`). */
export const ACCOUNT_DEACTIVATED = 'account-deactivated';

async function problemCode(response: Response): Promise<string | undefined> {
  try {
    const problem = (await response.json()) as { code?: unknown };
    return typeof problem.code === 'string' ? problem.code : undefined;
  } catch {
    return undefined;
  }
}

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

/** What a list of the administration area is asked for: a search text and a page, all checked by the controller. */
export interface AdminList {
  query?: string;
  page?: number;
  pageSize?: number;
}

/** What the audit log is asked for (#669): ids and dates that passed the controller's checks, and a page. */
export interface AuditFilter {
  subject?: string;
  actor?: string;
  from?: string;
  to?: string;
  page?: number;
  pageSize?: number;
}

/** The change of a group (`PATCH /admin/groups/:id`): either key may be left out. */
export interface AdminGroupPatch {
  name?: string;
  externalId?: string | null;
}

/** `?query=..&page=..&pageSize=..` from the three allowed values, encoded; empty when none is given. */
function adminQuery(list: AdminList): string {
  const params = new URLSearchParams();
  if (list.query !== undefined) params.append('query', list.query);
  if (list.page !== undefined) params.append('page', String(list.page));
  if (list.pageSize !== undefined) params.append('pageSize', String(list.pageSize));
  const text = params.toString();
  return text === '' ? '' : `?${text}`;
}
