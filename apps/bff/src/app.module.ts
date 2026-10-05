import { Module } from '@nestjs/common';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { BoardsModule } from './boards/boards.module.js';
import { HealthController } from './health.controller.js';

@Module({
  imports: [BoardsModule],
  controllers: [AppController, HealthController],
  providers: [AppService],
})
export class AppModule {}
