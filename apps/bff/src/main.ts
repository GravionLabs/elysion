import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { AppConfigService } from './config/config.module.js';
import { ConfigError, validateEnv } from './config/env.js';

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
  const app = await NestFactory.create(AppModule);
  await app.listen(app.get(AppConfigService).get('PORT'));
}

await bootstrap();
