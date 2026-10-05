import { Module } from '@nestjs/common';
import { AppConfigService } from '../config/config.module.js';
import { BoardsController } from './boards.controller.js';
import { BUSINESS_BACKEND_URL, BusinessBackendClient } from './business-backend.client.js';

/** `BUSINESS_BACKEND_URL` comes from the configuration (default: the business backend's dev port). */
@Module({
  controllers: [BoardsController],
  providers: [
    {
      provide: BUSINESS_BACKEND_URL,
      inject: [AppConfigService],
      useFactory: (config: AppConfigService) => config.get('BUSINESS_BACKEND_URL'),
    },
    BusinessBackendClient,
  ],
})
export class BoardsModule {}
