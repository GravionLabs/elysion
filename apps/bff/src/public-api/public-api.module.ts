import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { BoardsModule } from '../boards/boards.module.js';
import { ProblemDetailsFilter } from './problem-details.js';
import { PublicBoardsController } from './public-boards.controller.js';
import {
  PublicBoardMembersController,
  PublicRoomMembersController,
} from './public-members.controller.js';
import { PublicMeController } from './public-me.controller.js';
import { PublicRoomsController } from './public-rooms.controller.js';
import { PublicSnapshotsController } from './public-snapshots.controller.js';

/** The controllers of the public API, v1 (ADR 0033): the OpenAPI document is made from exactly these (openapi.ts). */
export const PUBLIC_API_CONTROLLERS = [
  PublicMeController,
  PublicBoardsController,
  PublicBoardMembersController,
  PublicRoomsController,
  PublicRoomMembersController,
  PublicSnapshotsController,
];

/**
 * The public API under `/public/v1` (ADR 0033): its own Traefik router and its own guard rules (`@PublicApi()`), the rate limit per
 * credential, and errors as problem details (`ProblemDetailsFilter`, which leaves every other route's errors as they are).
 */
@Module({
  imports: [BoardsModule],
  controllers: PUBLIC_API_CONTROLLERS,
  providers: [{ provide: APP_FILTER, useClass: ProblemDetailsFilter }],
})
export class PublicApiModule {}
