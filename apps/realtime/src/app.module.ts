import { Module } from '@nestjs/common';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
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
  imports: [RedisModule, PersistenceModule],
  controllers: [AppController],
  providers: [
    AppService,
    YjsGateway,
    YjsRoomRegistry,
    PresenceRelay,
    { provide: PERSISTENCE_OPTIONS, useFactory: persistenceOptionsFromEnv },
  ],
})
export class AppModule {}
