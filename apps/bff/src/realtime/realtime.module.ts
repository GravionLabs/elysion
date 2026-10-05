import { Module } from '@nestjs/common';
import { BoardsModule } from '../boards/boards.module.js';
import { RealtimeController } from './realtime.controller.js';
import { WsTokenService } from './ws-token.service.js';

@Module({
  imports: [BoardsModule],
  controllers: [RealtimeController],
  providers: [WsTokenService],
})
export class RealtimeModule {}
