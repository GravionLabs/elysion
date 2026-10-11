import { Module } from '@nestjs/common';
import { BoardsModule } from '../boards/boards.module.js';
import { AdminController } from './admin.controller.js';

/** The administration area of the instance (ADR 0027): a pass-through to the business backend's `/admin`. */
@Module({ imports: [BoardsModule], controllers: [AdminController] })
export class AdminModule {}
