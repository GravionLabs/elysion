import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig } from './config.js';

const WS = 'w'.repeat(32);
const INTERNAL = 'i'.repeat(32);
const valid = { WS_TOKEN_SECRET: WS, INTERNAL_API_SECRET: INTERNAL };

describe('loadConfig', () => {
  it('reads both secrets and defaults the log level to info', () => {
    expect(loadConfig(valid)).toEqual({
      wsTokenSecret: WS,
      internalApiSecret: INTERNAL,
      logLevel: 'info',
    });
  });

  it('reads the log viewer endpoint, which is off unless it is set, and refuses what is no URL', () => {
    expect(loadConfig(valid)).not.toHaveProperty('otlpLogsEndpoint');
    expect(
      loadConfig({
        ...valid,
        OTEL_EXPORTER_OTLP_LOGS_ENDPOINT: 'http://victorialogs:9428/insert/opentelemetry/v1/logs',
      }),
    ).toMatchObject({ otlpLogsEndpoint: 'http://victorialogs:9428/insert/opentelemetry/v1/logs' });
    expect(() => loadConfig({ ...valid, OTEL_EXPORTER_OTLP_LOGS_ENDPOINT: 'nope' })).toThrow(
      /OTEL_EXPORTER_OTLP_LOGS_ENDPOINT must be an http\(s\) URL/,
    );
  });

  it('reads the log level and format in any case, and refuses other words', () => {
    expect(loadConfig({ ...valid, LOG_LEVEL: 'DEBUG', LOG_FORMAT: 'Text' })).toMatchObject({
      logLevel: 'debug',
      logFormat: 'text',
    });
    expect(() => loadConfig({ ...valid, LOG_LEVEL: 'loud', LOG_FORMAT: 'xml' })).toThrow(
      /LOG_LEVEL must be one of trace, debug, info, warn, error, fatal, got "loud"[\s\S]*LOG_FORMAT must be one of json, text, got "xml"/,
    );
  });

  it.each(['WS_TOKEN_SECRET', 'INTERNAL_API_SECRET'])(
    'fails closed without %s, and says which variable',
    (name) => {
      for (const value of [undefined, '', '   ']) {
        const env = { ...valid, [name]: value };
        expect(() => loadConfig(env)).toThrow(ConfigError);
        expect(() => loadConfig(env)).toThrow(new RegExp(`${name} is required`));
      }
    },
  );

  it.each(['WS_TOKEN_SECRET', 'INTERNAL_API_SECRET'])('refuses a short %s', (name) => {
    expect(() => loadConfig({ ...valid, [name]: 'short' })).toThrow(
      new RegExp(`${name} must be at least 32`),
    );
  });

  it('reports every problem at once', () => {
    try {
      loadConfig({});
      expect.unreachable();
    } catch (error) {
      expect((error as Error).message).toContain('WS_TOKEN_SECRET');
      expect((error as Error).message).toContain('INTERNAL_API_SECRET');
    }
  });

  it('refuses the same value for both: one leaked secret must not forge both kinds of token', () => {
    expect(() => loadConfig({ WS_TOKEN_SECRET: WS, INTERNAL_API_SECRET: WS })).toThrow(
      /must not be the same value/,
    );
  });
});
