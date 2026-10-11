/** What the runner knows about the stack it tests. */
export interface Stack {
  /** The edge, `http://localhost`. */
  app: string;
  /** Keycloak, `http://localhost:8081`. */
  keycloak: string;
  user: string;
}

export function stackFromEnv(): Stack {
  return {
    app: process.env.APP ?? 'http://localhost',
    keycloak: process.env.KEYCLOAK ?? 'http://localhost:8081',
    user: process.env.LOAD_USER ?? 'dev1',
  };
}

/** Signs a demo user in (the password is the user name) and keeps the access token fresh: it lives for five minutes. */
export class Session {
  #token = '';
  #timer: NodeJS.Timeout | undefined;

  constructor(private readonly stack: Stack) {}

  async start(): Promise<void> {
    await this.#refresh();
    this.#timer = setInterval(() => void this.#refresh().catch(() => undefined), 3 * 60_000);
    this.#timer.unref();
  }

  stop(): void {
    clearInterval(this.#timer);
  }

  async #refresh(): Promise<void> {
    const response = await fetch(
      `${this.stack.keycloak}/realms/elysion/protocol/openid-connect/token`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'password',
          client_id: 'elysion-frontend',
          username: this.stack.user,
          password: this.stack.user,
        }),
      },
    );
    const body = (await response.json()) as { access_token?: string };
    if (!body.access_token)
      throw new Error(`${this.stack.user} cannot log in (${response.status})`);
    this.#token = body.access_token;
  }

  async api<T>(method: string, path: string, body?: unknown): Promise<T> {
    const response = await fetch(`${this.stack.app}/api${path}`, {
      method,
      headers: { authorization: `Bearer ${this.#token}`, 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!response.ok) {
      throw new Error(
        `${method} ${path}: ${response.status} ${(await response.text()).slice(0, 200)}`,
      );
    }
    const text = await response.text();
    return (text ? JSON.parse(text) : null) as T;
  }

  /** A board-scoped WS token, as the shell asks for one before every connection. */
  async wsToken(boardId: string): Promise<string> {
    return (await this.api<{ token: string }>('POST', '/realtime/token', { boardId })).token;
  }
}
