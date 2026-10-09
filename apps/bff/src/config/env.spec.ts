import { describe, expect, it } from 'vitest';
import { ConfigError, validateEnv } from './env.js';

const SECRET = 'x'.repeat(32);
const valid = { WS_TOKEN_SECRET: SECRET };

const messageOf = (env: Record<string, unknown>): string => {
  try {
    validateEnv(env);
  } catch (error) {
    expect(error).toBeInstanceOf(ConfigError);
    return (error as Error).message;
  }
  throw new Error('expected the environment to be refused');
};

describe('validateEnv', () => {
  it('loads a valid environment and fills in the defaults', () => {
    expect(validateEnv(valid)).toEqual({
      PORT: 3000,
      BUSINESS_BACKEND_URL: 'http://localhost:5174',
      OIDC_ISSUER_URL: 'http://localhost:8081/realms/elysion',
      OIDC_AUDIENCE: 'elysion-bff',
      WS_TOKEN_SECRET: SECRET,
      WS_TOKEN_TTL_SECONDS: 60,
      LOG_LEVEL: 'info',
    });
  });

  it('reads the log viewer endpoint, which is off unless it is set, and refuses what is no URL', () => {
    expect(validateEnv(valid)).not.toHaveProperty('OTEL_EXPORTER_OTLP_LOGS_ENDPOINT');
    expect(
      validateEnv({
        ...valid,
        OTEL_EXPORTER_OTLP_LOGS_ENDPOINT: 'http://victorialogs:9428/insert/opentelemetry/v1/logs',
        OTEL_EXPORTER_OTLP_LOGS_HEADERS: 'a=b',
      }),
    ).toMatchObject({
      OTEL_EXPORTER_OTLP_LOGS_ENDPOINT: 'http://victorialogs:9428/insert/opentelemetry/v1/logs',
      OTEL_EXPORTER_OTLP_LOGS_HEADERS: 'a=b',
    });
    expect(messageOf({ ...valid, OTEL_EXPORTER_OTLP_LOGS_ENDPOINT: 'not a url' })).toContain(
      'OTEL_EXPORTER_OTLP_LOGS_ENDPOINT must be an http(s) URL',
    );
  });

  it('reads the log level and format, in any case, and refuses other words', () => {
    expect(validateEnv({ ...valid, LOG_LEVEL: 'DEBUG', LOG_FORMAT: 'Text' })).toMatchObject({
      LOG_LEVEL: 'debug',
      LOG_FORMAT: 'text',
    });
    const message = messageOf({ ...valid, LOG_LEVEL: 'loud', LOG_FORMAT: 'xml' });
    expect(message).toContain('LOG_LEVEL must be one of trace, debug, info, warn, error, fatal');
    expect(message).toContain('LOG_FORMAT must be one of json, text, got "xml"');
  });

  it('turns numbers into numbers and keeps what is set', () => {
    const config = validateEnv({
      ...valid,
      PORT: '4000',
      BUSINESS_BACKEND_URL: 'http://business-backend:8080/',
      OIDC_ISSUER_URL: 'https://id.example.com/realms/elysion',
      OIDC_AUDIENCE: 'bff',
      OIDC_JWKS_URI: 'http://keycloak:8080/realms/elysion/protocol/openid-connect/certs',
      WS_TOKEN_TTL_SECONDS: '30',
    });

    expect(config).toMatchObject({
      PORT: 4000,
      BUSINESS_BACKEND_URL: 'http://business-backend:8080', // no trailing slash to double up with a path
      OIDC_ISSUER_URL: 'https://id.example.com/realms/elysion',
      OIDC_AUDIENCE: 'bff',
      OIDC_JWKS_URI: 'http://keycloak:8080/realms/elysion/protocol/openid-connect/certs',
      WS_TOKEN_TTL_SECONDS: 30,
    });
  });

  it('has no JWKS address unless one is set', () => {
    expect(validateEnv(valid)).not.toHaveProperty('OIDC_JWKS_URI');
    expect(validateEnv({ ...valid, OIDC_JWKS_URI: '  ' })).not.toHaveProperty('OIDC_JWKS_URI');
  });

  it('refuses a missing WS_TOKEN_SECRET and names it', () => {
    expect(messageOf({})).toContain('WS_TOKEN_SECRET is required');
    expect(messageOf({ WS_TOKEN_SECRET: '   ' })).toContain('WS_TOKEN_SECRET is required');
  });

  it('refuses a short secret', () => {
    expect(messageOf({ WS_TOKEN_SECRET: 'short' })).toContain(
      'WS_TOKEN_SECRET must be at least 32',
    );
  });

  it.each([
    ['PORT', 'abc'],
    ['PORT', '0'],
    ['PORT', '70000'],
    ['PORT', '30.5'],
    ['WS_TOKEN_TTL_SECONDS', '0'],
    ['WS_TOKEN_TTL_SECONDS', 'soon'],
    ['BUSINESS_BACKEND_URL', 'not a url'],
    ['BUSINESS_BACKEND_URL', 'ftp://host'],
    ['OIDC_ISSUER_URL', 'localhost:8081'],
    ['OIDC_JWKS_URI', 'nope'],
  ])('refuses %s=%s and names the variable', (name, value) => {
    expect(messageOf({ ...valid, [name]: value })).toContain(name);
  });

  it('reports every problem at once', () => {
    const message = messageOf({ PORT: 'x', BUSINESS_BACKEND_URL: 'y' });

    expect(message).toContain('PORT');
    expect(message).toContain('BUSINESS_BACKEND_URL');
    expect(message).toContain('WS_TOKEN_SECRET');
  });
});
