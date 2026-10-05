import { Module } from '@nestjs/common';
import { BoardsController } from './boards.controller.js';
import { BUSINESS_BACKEND_URL, BusinessBackendClient } from './business-backend.client.js';

/** `BUSINESS_BACKEND_URL` defaults to the business backend's dev port (see .vscode/launch.json). */
@Module({
  controllers: [BoardsController],
  providers: [
    {
      provide: BUSINESS_BACKEND_URL,
      useFactory: () => process.env.BUSINESS_BACKEND_URL ?? 'http://localhost:5174',
    },
    BusinessBackendClient,
  ],
})
export class BoardsModule {}
