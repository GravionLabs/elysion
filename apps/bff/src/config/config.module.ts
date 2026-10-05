import { Global, Injectable, Module } from '@nestjs/common';
import { ConfigModule as NestConfigModule, ConfigService, registerAs } from '@nestjs/config';
import { type AppConfig, validateEnv } from './env.js';

/** The key the validated configuration is registered under in `@nestjs/config`. */
const NAMESPACE = 'app';

/**
 * The typed accessor for the BFF's configuration: `config.get('PORT')` is a number. Read values here, never
 * from `process.env` directly.
 *
 * It does not use `ConfigService.get('PORT')` on purpose: that prefers the raw string in `process.env` over
 * the validated, converted value.
 */
@Injectable()
export class AppConfigService {
  constructor(private readonly config: ConfigService) {}

  get<K extends keyof AppConfig>(key: K): AppConfig[K] {
    return this.config.getOrThrow<AppConfig>(NAMESPACE)[key];
  }
}

/**
 * Global. `apps/bff/.env` (if present) is merged into `process.env`, and the result is validated when the
 * application starts (`validateEnv`), so a bad environment stops the process before it listens.
 */
@Global()
@Module({
  imports: [
    NestConfigModule.forRoot({
      isGlobal: true,
      load: [registerAs(NAMESPACE, () => validateEnv(process.env))],
    }),
  ],
  providers: [AppConfigService],
  exports: [AppConfigService],
})
export class ConfigModule {}
