import type { BoardRole } from '@elysion/shared-types';
import {
  BadGatewayException,
  BadRequestException,
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
      throw new NotFoundException();
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
