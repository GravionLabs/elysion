import { Module } from '@nestjs/common';
import { AppController } from './app.controller.js';
import { HealthController } from './health.controller.js';
import { AppService } from './app.service.js';
import { AuthModule } from './auth/auth.module.js';
import { LoggingModule } from './logging/logging.module.js';
import { MetricsController } from './metrics/metrics.controller.js';
import { MetricsService } from './metrics/metrics.service.js';
import { SaveMetrics } from './metrics/save-metrics.js';
import { DocumentRelay } from './document/document-relay.js';
import { InternalTokenSigner } from './auth/internal-token-signer.js';
import { loadConfig } from './config/config.js';
import { HttpMembershipSource, MembershipSource } from './membership/membership-source.js';
import {
  MEMBERSHIP_OPTIONS,
  MembershipWatcher,
  membershipOptionsFromEnv,
} from './membership/membership-watcher.js';
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
    SaveMetrics,
    YjsGateway,
    YjsRoomRegistry,
    PresenceRelay,
    DocumentRelay,
    MembershipWatcher,
    {
      provide: MembershipSource,
      useFactory: () =>
        new HttpMembershipSource(
          new InternalTokenSigner(loadConfig(process.env).internalApiSecret),
        ),
    },
    { provide: MEMBERSHIP_OPTIONS, useFactory: membershipOptionsFromEnv },
    { provide: PERSISTENCE_OPTIONS, useFactory: persistenceOptionsFromEnv },
  ],
})
export class AppModule {}
