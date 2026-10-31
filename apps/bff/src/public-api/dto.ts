import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

// The shapes of the public API (ADR 0033) as the OpenAPI document describes them. They are documentation only: the controllers
// build their answers from the business backend's and check request bodies themselves. Every field has an example; a field that
// can be null says so with `nullable`, which the document turns into OpenAPI 3.1's `type: [..., "null"]` (openapi.ts).

const BOARD_ID = '0192f7a4-6f0e-7c3b-9d51-2a4b6c8d0e1f';
const ROOM_ID = '0192f7a4-7a11-7d42-8e60-3b5c7d9e1f20';
const USER_ID = '0192f7a4-81c2-7e53-9f71-4c6d8e0f2a31';
const SNAPSHOT_ID = '0192f7a5-0c3d-7f64-a082-5d7e9f1a3b42';

export const EXAMPLE_IDS = { BOARD_ID, ROOM_ID, USER_ID, SNAPSHOT_ID };

const ROLES = ['Owner', 'Editor', 'Viewer'];

export class Problem {
  @ApiProperty({
    example: 'about:blank',
    description: 'Always `about:blank`: the status says what happened.',
  })
  type: string;
  @ApiProperty({ example: 'Not Found', description: 'The standard text of the status.' })
  title: string;
  @ApiProperty({ example: 404 })
  status: number;
  @ApiPropertyOptional({ example: 'This needs a token with the scope "boards:write".' })
  detail?: string;
  @ApiPropertyOptional({
    example: 'account-deactivated',
    description:
      "Elysion's own code where a client may act on it: `account-deactivated` for a deactivated owner.",
  })
  code?: string;
}

export class Me {
  @ApiProperty({ example: USER_ID })
  id: string;
  @ApiProperty({ example: 'Ada Lovelace' })
  name: string;
  @ApiProperty({ enum: ['person', 'integration'], example: 'person' })
  kind: string;
  @ApiProperty({
    type: 'string',
    nullable: true,
    example: '0192f7a5-1d4e-7075-b193-6e8f0a2b4c53',
    description: 'The id of the personal access token; null for a Keycloak token.',
  })
  tokenId: string | null;
  @ApiProperty({ type: [String], example: ['boards:read'] })
  scopes: string[];
}

export class PublicBoard {
  @ApiProperty({ format: 'uuid', example: BOARD_ID })
  id: string;
  @ApiProperty({ example: 'Sprint 42 retro' })
  name: string;
  @ApiProperty({ format: 'date-time', example: '2026-10-31T09:15:00Z' })
  createdAt: string;
  @ApiProperty({
    type: 'string',
    format: 'uuid',
    nullable: true,
    example: ROOM_ID,
    description: 'The room the board is in; null for none.',
  })
  roomId: string | null;
}

export class BoardPage {
  @ApiProperty({ type: [PublicBoard] })
  items: PublicBoard[];
  @ApiProperty({
    type: 'string',
    nullable: true,
    example: 'WzE3NjE5MDIxMDAwMDAsIjAxOTJmN2E0Il0',
    description: 'The cursor of the next page; null on the last one.',
  })
  next: string | null;
}

export class BoardName {
  @ApiProperty({ example: 'Sprint 42 retro', minLength: 1, maxLength: 120 })
  name: string;
}

export class PublicRoom {
  @ApiProperty({ format: 'uuid', example: ROOM_ID })
  id: string;
  @ApiProperty({ example: 'Team Phoenix' })
  name: string;
  @ApiProperty({ format: 'date-time', example: '2026-09-01T08:00:00Z' })
  createdAt: string;
  @ApiProperty({ enum: ROLES, example: 'Editor', description: "The caller's role in the room." })
  role: string;
}

export class RoomPage {
  @ApiProperty({ type: [PublicRoom] })
  items: PublicRoom[];
  @ApiProperty({ type: 'string', nullable: true, example: null })
  next: string | null;
}

export class Member {
  @ApiProperty({ format: 'uuid', example: USER_ID })
  userId: string;
  @ApiProperty({ example: 'Ada Lovelace' })
  displayName: string;
  @ApiProperty({ type: 'string', nullable: true, example: 'ada@example.com' })
  email: string | null;
  @ApiProperty({ enum: ROLES, example: 'Editor' })
  role: string;
}

export class MemberPage {
  @ApiProperty({ type: [Member] })
  items: Member[];
  @ApiProperty({ type: 'string', nullable: true, example: null })
  next: string | null;
}

export class AddMember {
  @ApiPropertyOptional({
    example: 'ada@example.com',
    description: 'The email of the person; or `userId`.',
  })
  email?: string;
  @ApiPropertyOptional({
    format: 'uuid',
    example: USER_ID,
    description: 'The id of the person or integration; or `email`.',
  })
  userId?: string;
  @ApiProperty({ enum: ROLES, example: 'Editor' })
  role: string;
}

export class MemberRole {
  @ApiProperty({ enum: ROLES, example: 'Viewer' })
  role: string;
}

export class Snapshot {
  @ApiProperty({ format: 'uuid', example: SNAPSHOT_ID })
  id: string;
  @ApiProperty({
    enum: ['Manual', 'Auto', 'BeforeRestore'],
    example: 'Manual',
    description:
      '`Manual`: saved by somebody; `Auto`: kept by Elysion; `BeforeRestore`: the state before a restore.',
  })
  kind: string;
  @ApiProperty({ type: 'string', nullable: true, example: 'Before the workshop' })
  name: string | null;
  @ApiProperty({
    type: 'string',
    nullable: true,
    example: 'Ada Lovelace',
    description: 'Null for an automatic version.',
  })
  author: string | null;
  @ApiProperty({ format: 'date-time', example: '2026-10-31T10:00:00Z' })
  createdAt: string;
  @ApiProperty({ example: 48213 })
  sizeBytes: number;
  @ApiProperty({ type: 'integer', nullable: true, example: 37 })
  elementCount: number | null;
}

export class SnapshotPage {
  @ApiProperty({ type: [Snapshot] })
  items: Snapshot[];
  @ApiProperty({ type: 'string', nullable: true, example: null })
  next: string | null;
}

export class SnapshotName {
  @ApiPropertyOptional({
    example: 'Before the workshop',
    maxLength: 100,
    description: 'Optional; without it the version is unnamed.',
  })
  name?: string;
}

export class SceneFile {
  @ApiProperty({ example: 'f3a9c1d27b' })
  id: string;
  @ApiProperty({ example: 'image/png' })
  mimeType: string;
  @ApiProperty({
    example: 1761902100000,
    description: 'When the file was added, in milliseconds since 1970.',
  })
  created: number;
  @ApiProperty({
    example: `/public/v1/boards/${BOARD_ID}/files/f3a9c1d27b`,
    description: 'Where the bytes are: a public API route that needs `boards:read`. Never inline.',
  })
  url: string;
}

export class Scene {
  @ApiProperty({ enum: ['excalidraw'], example: 'excalidraw' })
  type: string;
  @ApiProperty({ enum: [2], example: 2 })
  version: number;
  @ApiProperty({ enum: ['elysion'], example: 'elysion' })
  source: string;
  @ApiProperty({
    type: 'array',
    items: { type: 'object', additionalProperties: true },
    description:
      'The live elements in drawing order, as Excalidraw stores them (deleted ones are left out).',
    example: [
      { id: 'k3Jd9', type: 'rectangle', x: 120, y: 80, width: 200, height: 120, index: 'a0' },
    ],
  })
  elements: Array<Record<string, unknown>>;
  @ApiProperty({ type: 'object', additionalProperties: false, example: {} })
  appState: Record<string, never>;
  @ApiProperty({
    type: 'object',
    additionalProperties: { $ref: '#/components/schemas/SceneFile' },
    description: 'The files the elements show, by id, as links.',
    example: {},
  })
  files: Record<string, SceneFile>;
}

export class SnapshotWithScene extends Snapshot {
  @ApiProperty({ type: Scene })
  scene: Scene;
}
