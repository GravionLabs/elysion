import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module.js';
import { AppConfigService } from './config/config.module.js';
import { ConfigError, validateEnv } from './config/env.js';
import { applyHttpLimits } from './http-limits.js';

async function bootstrap() {
  // Checked before Nest starts, so a bad environment ends with the message below and not with a stack trace
  // (importing AppModule has already merged apps/bff/.env into process.env). The module validates again
  // when it is created; that second check is the one the tests and any other entry point rely on.
  try {
    validateEnv(process.env);
  } catch (error) {
    if (error instanceof ConfigError) {
      console.error(error.message);
      process.exit(1);
    }
    throw error;
  }
  // Buffered until pino is set up, so the start-up lines have the same shape as the rest (ADR 0025).
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));
  applyHttpLimits(app);
  await app.listen(app.get(AppConfigService).get('PORT'));
}

await bootstrap();
