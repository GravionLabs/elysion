import type { LogFormat, LogLevel } from '@elysion/node-logging';

/** The BFF's configuration, read once from the environment at startup (names: docs/specs/identity.md). */
export interface AppConfig {
  /** Port of the BFF. */
  PORT: number;
  /** The business backend, whose dev port is set in `.vscode/launch.json`. */
  BUSINESS_BACKEND_URL: string;
  /** The `iss` the Keycloak access tokens carry. */
  OIDC_ISSUER_URL: string;
  /** The audience an access token must contain. */
  OIDC_AUDIENCE: string;
  /** Where to fetch Keycloak's signing keys, when that differs from the issuer's address (inside compose). */
  OIDC_JWKS_URI?: string;
  /** HS256 secret of the WS token, shared with the realtime service. Required: there is no safe default. */
  WS_TOKEN_SECRET: string;
  /** Lifetime of a WS token in seconds. */
  WS_TOKEN_TTL_SECONDS: number;
  /** `trace`, `debug`, `info`, `warn`, `error` or `fatal` (ADR 0025). */
  LOG_LEVEL: LogLevel;
  /** `json` or `text`; unset: text in a terminal, JSON everywhere else (a container). */
  LOG_FORMAT?: LogFormat;
}

/** The environment is not usable. The message names every variable that is wrong. */
export class ConfigError extends Error {
  constructor(problems: readonly string[]) {
    super(`Invalid configuration:\n${problems.map((problem) => `  - ${problem}`).join('\n')}`);
    this.name = 'ConfigError';
  }
}

type Env = Record<string, unknown>;

const MIN_SECRET_LENGTH = 32;

/**
 * Checks the environment against the schema and returns it typed, with defaults filled in. Collects every
 * problem instead of stopping at the first, so one start shows everything that has to be fixed.
 * `@nestjs/config` calls it with `process.env` merged with the `.env` file.
 */
export function validateEnv(env: Env): AppConfig {
  const problems: string[] = [];
  const text = (name: string): string | undefined => {
    const value = env[name];
    return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;
  };
  const url = (name: string, fallback?: string): string => {
    const value = text(name) ?? fallback;
    if (value === undefined) {
      problems.push(`${name} is required (a URL)`);
      return '';
    }
    try {
      const parsed = new URL(value);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        throw new Error('not http(s)');
      }
    } catch {
      problems.push(`${name} must be an http(s) URL, got "${value}"`);
    }
    return value.replace(/\/+$/, '');
  };
  const integer = (name: string, fallback: number, min: number, max: number): number => {
    const raw = text(name);
    if (raw === undefined) {
      return fallback;
    }
    const value = Number(raw);
    if (!Number.isInteger(value) || value < min || value > max) {
      problems.push(`${name} must be a whole number from ${min} to ${max}, got "${raw}"`);
      return fallback;
    }
    return value;
  };

  const oneOf = <T extends string>(name: string, allowed: readonly T[]): T | undefined => {
    const raw = text(name)?.toLowerCase();
    if (raw === undefined) {
      return undefined;
    }
    const match = allowed.find((candidate) => candidate === raw);
    if (match === undefined) {
      problems.push(`${name} must be one of ${allowed.join(', ')}, got "${raw}"`);
    }
    return match;
  };
  const logFormat = oneOf<LogFormat>('LOG_FORMAT', ['json', 'text']);

  const secret = text('WS_TOKEN_SECRET');
  if (secret === undefined) {
    problems.push(
      `WS_TOKEN_SECRET is required (at least ${MIN_SECRET_LENGTH} characters; see apps/bff/.env.example)`,
    );
  } else if (secret.length < MIN_SECRET_LENGTH) {
    problems.push(`WS_TOKEN_SECRET must be at least ${MIN_SECRET_LENGTH} characters long`);
  }

  const config: AppConfig = {
    PORT: integer('PORT', 3000, 1, 65535),
    BUSINESS_BACKEND_URL: url('BUSINESS_BACKEND_URL', 'http://localhost:5174'),
    OIDC_ISSUER_URL: url('OIDC_ISSUER_URL', 'http://localhost:8081/realms/elysion'),
    OIDC_AUDIENCE: text('OIDC_AUDIENCE') ?? 'elysion-bff',
    ...(text('OIDC_JWKS_URI') === undefined ? {} : { OIDC_JWKS_URI: url('OIDC_JWKS_URI') }),
    WS_TOKEN_SECRET: secret ?? '',
    WS_TOKEN_TTL_SECONDS: integer('WS_TOKEN_TTL_SECONDS', 60, 1, 3600),
    LOG_LEVEL:
      oneOf<LogLevel>('LOG_LEVEL', ['trace', 'debug', 'info', 'warn', 'error', 'fatal']) ?? 'info',
    ...(logFormat === undefined ? {} : { LOG_FORMAT: logFormat }),
  };

  if (problems.length > 0) {
    throw new ConfigError(problems);
  }
  return config;
}
