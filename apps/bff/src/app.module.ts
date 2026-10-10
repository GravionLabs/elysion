import { Module } from '@nestjs/common';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { AuthModule } from './auth/auth.module.js';
import { BoardsModule } from './boards/boards.module.js';
import { MetricsModule } from './metrics/metrics.module.js';
import { ConfigModule } from './config/config.module.js';
import { RealtimeModule } from './realtime/realtime.module.js';
import { CspReportController } from './csp/csp-report.controller.js';
import { HealthController } from './health.controller.js';
import { LoggingModule } from './logging/logging.module.js';

@Module({
  imports: [ConfigModule, LoggingModule, MetricsModule, AuthModule, BoardsModule, RealtimeModule],
  controllers: [AppController, HealthController, CspReportController],
  providers: [AppService],
})
export class AppModule {}
