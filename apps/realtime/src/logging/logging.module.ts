import { createPinoHttpOptions, requestIdMiddleware } from '@elysion/node-logging';
import { type MiddlewareConsumer, Module, type NestModule } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';
import type { DestinationStream } from 'pino';

/** Where JSON log lines go: unset (stdout) in the application, a stream in a test that reads the output. */
export const LOG_STREAM = Symbol('LOG_STREAM');

/** Health checks and metrics run every few seconds: their request line is `debug`. */
const QUIET_PATHS = ['/health', '/metrics'];

/**
 * Logging for the realtime service (ADR 0025, docs/specs/realtime.md "Logging"): `nestjs-pino` with the options all
 * Node services share. HTTP requests (health, metrics) get the request line and id; a WebSocket connection gets its own
 * id from the upgrade request, see `YjsGateway`. The level and format come from `LOG_LEVEL` and `LOG_FORMAT`, which
 * `loadConfig` has already validated when the service starts.
 */
@Module({
  imports: [
    LoggerModule.forRootAsync({
      providers: [{ provide: LOG_STREAM, useValue: undefined }],
      inject: [LOG_STREAM],
      useFactory: (stream: DestinationStream | undefined) => ({
        // The string form, like the metrics middleware of the BFF: see apps/bff/src/logging/logging.module.ts.
        forRoutes: ['*path'],
        pinoHttp: createPinoHttpOptions({
          service: 'elysion-realtime',
          level: process.env.LOG_LEVEL,
          format: process.env.LOG_FORMAT,
          otlpEndpoint: process.env.OTEL_EXPORTER_OTLP_LOGS_ENDPOINT,
          otlpHeaders: process.env.OTEL_EXPORTER_OTLP_LOGS_HEADERS,
          quietPaths: QUIET_PATHS,
          stream,
        }),
      }),
    }),
  ],
})
export class LoggingModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(requestIdMiddleware()).forRoutes('*path');
  }
}
