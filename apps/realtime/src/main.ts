import { existsSync } from 'node:fs';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Logger } from 'nestjs-pino';
import { WsAdapter } from '@nestjs/platform-ws';
import { AppModule } from './app.module.js';
import { ConfigError, loadConfig } from './config/config.js';

async function bootstrap() {
  // A local `.env` (apps/realtime/.env, see .env.example) fills in what the environment does not set.
  if (existsSync('.env')) {
    process.loadEnvFile('.env');
  }
  try {
    loadConfig(process.env);
  } catch (error) {
    if (error instanceof ConfigError) {
      // A readable message instead of a stack trace: the fix is in the environment, not in the code.
      console.error(error.message);
      process.exit(1);
    }
    throw error;
  }
  // Buffered until pino is set up, so the start-up lines have the same shape as the rest (ADR 0025).
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bufferLogs: true });
  app.disable('x-powered-by'); // no `X-Powered-By: Express` banner (#781)
  app.useLogger(app.get(Logger));
  app.useWebSocketAdapter(new WsAdapter(app));
  // SIGTERM (a container stop, a pod's deletion) runs onModuleDestroy: the registry saves every room that has unsaved changes.
  app.enableShutdownHooks();
  await app.listen(process.env.PORT ?? 3000);
}
await bootstrap();
