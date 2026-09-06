import { Module } from '@nestjs/common';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { EchoGateway } from './echo.gateway.js';

@Module({
  imports: [],
  controllers: [AppController],
  providers: [AppService, EchoGateway],
})
export class AppModule {}
