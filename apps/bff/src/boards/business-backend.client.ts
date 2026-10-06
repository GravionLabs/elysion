import type { BoardRole } from '@elysion/shared-types';
import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';

/** Base URL of the business backend, e.g. `http://localhost:5174`. */
export const BUSINESS_BACKEND_URL = Symbol('BUSINESS_BACKEND_URL');

/** A board as the business backend's Board API returns it. */
export interface Board {
  id: string;
  name: string;
  createdAt: string;
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

/** A member of a board as the business backend's member API returns it. */
export interface BoardMember {
  userId: string;
  displayName: string;
  email: string | null;
  role: 'Owner' | 'Editor' | 'Viewer';
}

const TIMEOUT_MS = 5000;

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

  listTemplates(token: string): Promise<TemplateSummary[]> {
    return this.request<TemplateSummary[]>(token, 'GET', '/templates');
  }

  getTemplate(token: string, id: string): Promise<Template> {
    return this.request<Template>(token, 'GET', `/templates/${id}`);
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

  async deleteBoard(token: string, id: string): Promise<void> {
    await this.request<void>(token, 'DELETE', `/boards/${id}`);
  }

  private async request<T>(
    token: string,
    method: string,
    path: string,
    body?: unknown,
  ): Promise<T> {
    let response: Response;
    try {
      response = await fetch(new URL(path, this.baseUrl), {
        method,
        headers: {
          authorization: `Bearer ${token}`,
          ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch {
      throw new BadGatewayException('The business backend is not reachable.');
    }

    if (response.ok) {
      return (response.status === 204 ? undefined : await response.json()) as T;
    }
    if (response.status === 401) {
      throw new UnauthorizedException();
    }
    if (response.status === 403) {
      throw new ForbiddenException();
    }
    if (response.status === 404) {
      // A board that is not visible has no body; the member API says why (an unknown email, not a member).
      throw new NotFoundException(await problemDetail(response));
    }
    if (response.status === 409) {
      throw new ConflictException(await problemDetail(response));
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
