import { Module } from '@nestjs/common';
import { AppController } from './app.controller.js';
import { HealthController } from './health.controller.js';
import { AppService } from './app.service.js';
import { AuthModule } from './auth/auth.module.js';
import { LoggingModule } from './logging/logging.module.js';
import { MetricsController } from './metrics/metrics.controller.js';
import { MetricsService } from './metrics/metrics.service.js';
import { DocumentRelay } from './document/document-relay.js';
import { PersistenceModule } from './persistence/persistence.module.js';
import { PresenceRelay } from './presence/presence-relay.js';
import { RedisModule } from './redis/redis.module.js';
import { YjsGateway } from './yjs/yjs.gateway.js';
import {
  PERSISTENCE_OPTIONS,
  YjsRoomRegistry,
  persistenceOptionsFromEnv,
} from './yjs/yjs-room-registry.js';

@Module({
  imports: [LoggingModule, AuthModule, RedisModule, PersistenceModule],
  controllers: [AppController, HealthController, MetricsController],
  providers: [
    AppService,
    MetricsService,
    YjsGateway,
    YjsRoomRegistry,
    PresenceRelay,
    DocumentRelay,
    { provide: PERSISTENCE_OPTIONS, useFactory: persistenceOptionsFromEnv },
  ],
})
export class AppModule {}
