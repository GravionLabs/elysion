import { createPinoHttpOptions, requestIdMiddleware } from '@elysion/node-logging';
import { type MiddlewareConsumer, Module, type NestModule } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';
import type { DestinationStream } from 'pino';
import { AppConfigService } from '../config/config.module.js';

/** Where JSON log lines go: unset (stdout) in the application, a stream in a test that reads the output. */
export const LOG_STREAM = Symbol('LOG_STREAM');

/** Health checks and metrics run every few seconds: their request line is `debug`. */
const QUIET_PATHS = ['/health', '/metrics'];

/**
 * Logging for the BFF (ADR 0025, docs/specs/bff.md "Logging"): `nestjs-pino` with the options all Node services share,
 * and the request id as the current request's id, so that calls to the business backend can forward it.
 */
@Module({
  imports: [
    LoggerModule.forRootAsync({
      providers: [{ provide: LOG_STREAM, useValue: undefined }],
      inject: [AppConfigService, LOG_STREAM],
      useFactory: (config: AppConfigService, stream: DestinationStream | undefined) => ({
        // The string form, like the metrics middleware: a path with a method registers an Express *route*, and then every
        // request that matched no controller would report that wildcard as its route (in the log and in the metrics).
        forRoutes: ['*path'],
        pinoHttp: createPinoHttpOptions({
          service: 'elysion-bff',
          level: config.get('LOG_LEVEL'),
          format: config.get('LOG_FORMAT'),
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
