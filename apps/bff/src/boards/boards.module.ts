import { Module } from '@nestjs/common';
import { AppConfigService } from '../config/config.module.js';
import { BoardsController } from './boards.controller.js';
import { FilesController } from './files.controller.js';
import { ThumbnailController } from './thumbnail.controller.js';
import { SnapshotsController } from './snapshots.controller.js';
import { VotingController } from './voting.controller.js';
import { InvitationsController } from './invitations.controller.js';
import { TemplatesController } from './templates.controller.js';
import { MembersController } from './members.controller.js';
import { RoomMembersController } from './room-members.controller.js';
import { GroupsController } from './groups.controller.js';
import { UsersController } from './users.controller.js';
import { AccessTokensController } from './access-tokens.controller.js';
import { RoomGroupsController } from './room-groups.controller.js';
import { RoomsController } from './rooms.controller.js';
import { BUSINESS_BACKEND_URL, BusinessBackendClient } from './business-backend.client.js';

/** `BUSINESS_BACKEND_URL` comes from the configuration (default: the business backend's dev port). */
@Module({
  controllers: [
    BoardsController,
    FilesController,
    ThumbnailController,
    SnapshotsController,
    VotingController,
    InvitationsController,
    MembersController,
    RoomsController,
    RoomMembersController,
    GroupsController,
    UsersController,
    AccessTokensController,
    RoomGroupsController,
    TemplatesController,
  ],
  providers: [
    {
      provide: BUSINESS_BACKEND_URL,
      inject: [AppConfigService],
      useFactory: (config: AppConfigService) => config.get('BUSINESS_BACKEND_URL'),
    },
    BusinessBackendClient,
  ],
  exports: [BusinessBackendClient],
})
export class BoardsModule {}
