import {
  BadGatewayException,
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
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
 * Talks to the business backend's Board API and turns its failures into the HTTP errors the BFF
 * answers with: 404 stays 404, a rejected name stays 400 (with the backend's message), and
 * anything else, including an unreachable backend, is a 502.
 */
@Injectable()
export class BusinessBackendClient {
  constructor(@Inject(BUSINESS_BACKEND_URL) private readonly baseUrl: string) {}

  listBoards(): Promise<Board[]> {
    return this.request<Board[]>('GET', '/boards');
  }

  getBoard(id: string): Promise<Board> {
    return this.request<Board>('GET', `/boards/${id}`);
  }

  createBoard(name: string): Promise<Board> {
    return this.request<Board>('POST', '/boards', { name });
  }

  renameBoard(id: string, name: string): Promise<Board> {
    return this.request<Board>('PATCH', `/boards/${id}`, { name });
  }

  async deleteBoard(id: string): Promise<void> {
    await this.request<void>('DELETE', `/boards/${id}`);
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    let response: Response;
    try {
      response = await fetch(new URL(path, this.baseUrl), {
        method,
        headers: body === undefined ? undefined : { 'content-type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch {
      throw new BadGatewayException('The business backend is not reachable.');
    }

    if (response.ok) {
      return (response.status === 204 ? undefined : await response.json()) as T;
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
