import { Module } from '@nestjs/common';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { PresenceRelay } from './presence/presence-relay.js';
import { RedisModule } from './redis/redis.module.js';
import { YjsGateway } from './yjs/yjs.gateway.js';
import { YjsRoomRegistry } from './yjs/yjs-room-registry.js';

@Module({
  imports: [RedisModule],
  controllers: [AppController],
  providers: [AppService, YjsGateway, YjsRoomRegistry, PresenceRelay],
})
export class AppModule {}
