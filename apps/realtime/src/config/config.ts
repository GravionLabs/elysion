import type { LogFormat, LogLevel } from '@elysion/node-logging';

/** The realtime service's configuration that must be right before it accepts a connection. */
export interface RealtimeConfig {
  /** HS256 secret of the WS token, shared with the BFF. Required: there is no safe default. */
  wsTokenSecret: string;
  /** HS256 secret of the service token for the business backend's internal API (ADR 0017), shared with it. Required. */
  internalApiSecret: string;
  /** `trace`, `debug`, `info`, `warn`, `error` or `fatal` (ADR 0025). */
  logLevel: LogLevel;
  /** `json` or `text`; unset: text in a terminal, JSON everywhere else (a container). */
  logFormat?: LogFormat;
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
 * Reads what has to be set from the environment. Fails closed: without the secrets the service does not start,
 * instead of accepting connections without checking who they are or calling the backend without proving who it is.
 * Every problem is reported at once.
 */
export function loadConfig(env: Record<string, string | undefined>): RealtimeConfig {
  const problems: string[] = [];
  const secret = (name: string, hint: string): string => {
    const value = env[name]?.trim();
    if (!value) {
      problems.push(
        `${name} is required (at least ${MIN_SECRET_LENGTH} characters, ${hint}; see apps/realtime/.env.example)`,
      );
      return '';
    }
    if (value.length < MIN_SECRET_LENGTH) {
      problems.push(`${name} must be at least ${MIN_SECRET_LENGTH} characters long`);
    }
    return value;
  };

  const wsTokenSecret = secret('WS_TOKEN_SECRET', 'the same as in the BFF');
  const internalApiSecret = secret('INTERNAL_API_SECRET', 'the same as in the business backend');
  if (wsTokenSecret !== '' && wsTokenSecret === internalApiSecret) {
    // One leaked secret must not be enough to forge both kinds of token (ADR 0017).
    problems.push('INTERNAL_API_SECRET must not be the same value as WS_TOKEN_SECRET');
  }

  const oneOf = <T extends string>(name: string, allowed: readonly T[]): T | undefined => {
    const raw = env[name]?.trim().toLowerCase();
    if (!raw) {
      return undefined;
    }
    const match = allowed.find((candidate) => candidate === raw);
    if (match === undefined) {
      problems.push(`${name} must be one of ${allowed.join(', ')}, got "${raw}"`);
    }
    return match;
  };
  const logLevel =
    oneOf<LogLevel>('LOG_LEVEL', ['trace', 'debug', 'info', 'warn', 'error', 'fatal']) ?? 'info';
  const logFormat = oneOf<LogFormat>('LOG_FORMAT', ['json', 'text']);

  if (problems.length > 0) {
    throw new ConfigError(problems);
  }
  return { wsTokenSecret, internalApiSecret, logLevel, ...(logFormat ? { logFormat } : {}) };
}
