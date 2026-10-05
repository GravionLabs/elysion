/** The realtime service's configuration that must be right before it accepts a connection. */
export interface RealtimeConfig {
  /** HS256 secret of the WS token, shared with the BFF. Required: there is no safe default. */
  wsTokenSecret: string;
}

/** The environment is not usable. The message names every variable that is wrong. */
export class ConfigError extends Error {
  constructor(problems: readonly string[]) {
    super(`Invalid configuration:\n${problems.map((problem) => `  - ${problem}`).join('\n')}`);
    this.name = 'ConfigError';
  }
}

export const MIN_SECRET_LENGTH = 32;

/**
 * Reads what has to be set from the environment. Fails closed: without `WS_TOKEN_SECRET` the service does not
 * start, instead of accepting connections without checking who they are.
 */
export function loadConfig(env: Record<string, string | undefined>): RealtimeConfig {
  const secret = env.WS_TOKEN_SECRET?.trim();
  if (!secret) {
    throw new ConfigError([
      `WS_TOKEN_SECRET is required (at least ${MIN_SECRET_LENGTH} characters, the same as in the BFF; see apps/realtime/.env.example)`,
    ]);
  }
  if (secret.length < MIN_SECRET_LENGTH) {
    throw new ConfigError([
      `WS_TOKEN_SECRET must be at least ${MIN_SECRET_LENGTH} characters long`,
    ]);
  }
  return { wsTokenSecret: secret };
}
