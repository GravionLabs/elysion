import { existsSync } from 'node:fs';
import { NestFactory } from '@nestjs/core';
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
  const app = await NestFactory.create(AppModule);
  app.useWebSocketAdapter(new WsAdapter(app));
  await app.listen(process.env.PORT ?? 3000);
}
await bootstrap();
