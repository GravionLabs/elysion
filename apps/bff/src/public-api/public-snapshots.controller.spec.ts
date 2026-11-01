import { NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import type { Response } from 'express';
import { describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import type { BoardSnapshot, BusinessBackendClient } from '../boards/business-backend.client.js';
import { PublicSnapshotsController } from './public-snapshots.controller.js';

const TOKEN = `elp_${'s'.repeat(43)}`;
const BOARD_ID = '0192f7a5-6c1d-7e2f-8a3b-4c5d6e7f8a9b';
const SNAPSHOT_ID = '0192f7a7-3c4d-7e5f-8061-728394a5b6c7';

const snapshot = (id: string, createdAt: string): BoardSnapshot => ({
  id,
  kind: 'Manual',
  name: 'Before',
  author: 'Ada',
  createdAt,
  sizeBytes: 120,
  elementCount: 1,
});

const backendWith = (calls: Partial<Record<keyof BusinessBackendClient, unknown>>) =>
  calls as unknown as BusinessBackendClient;

function responseRecorder() {
  const headers: Record<string, string> = {};
  const response = {
    setHeader: (name: string, value: string) => {
      headers[name] = value;
    },
  } as unknown as Response;
  return { headers, response };
}

describe('PublicSnapshotsController', () => {
  describe('list', () => {
    it("lists with the caller's token, newest first, a page at a time", async () => {
      const older = snapshot('s1', '2026-10-01T11:00:00Z');
      const newer = snapshot('s2', '2026-10-01T12:00:00Z');
      const listSnapshots = vi.fn().mockResolvedValue([older, newer]);
      const controller = new PublicSnapshotsController(backendWith({ listSnapshots }));

      const first = await controller.list(TOKEN, BOARD_ID, undefined, '1');
      const second = await controller.list(TOKEN, BOARD_ID, first.next, '1');

      expect(listSnapshots).toHaveBeenCalledWith(TOKEN, BOARD_ID);
      expect(first.items).toEqual([newer]);
      expect(second).toEqual({ items: [older], next: null });
    });

    it('answers a missing name, author or element count as null', async () => {
      const bare = {
        ...snapshot('s1', '2026-10-01T11:00:00Z'),
        kind: 'Auto',
      } as Partial<BoardSnapshot>;
      delete bare.name;
      delete bare.author;
      delete bare.elementCount;
      const controller = new PublicSnapshotsController(
        backendWith({ listSnapshots: vi.fn().mockResolvedValue([bare]) }),
      );

      const page = await controller.list(TOKEN, BOARD_ID);

      expect(page.items[0]).toMatchObject({ name: null, author: null, elementCount: null });
    });

    it("passes the backend's 404 on for a board the caller has no role on", async () => {
      const controller = new PublicSnapshotsController(
        backendWith({ listSnapshots: vi.fn().mockRejectedValue(new NotFoundException()) }),
      );

      await expect(controller.list(TOKEN, BOARD_ID)).rejects.toThrow(NotFoundException);
    });
  });

  describe('create', () => {
    it("saves with the caller's token and answers the version with its address", async () => {
      const saved = snapshot(SNAPSHOT_ID, '2026-10-01T11:00:00Z');
      const createSnapshot = vi.fn().mockResolvedValue(saved);
      const controller = new PublicSnapshotsController(backendWith({ createSnapshot }));
      const { headers, response } = responseRecorder();

      const answer = await controller.create(TOKEN, BOARD_ID, { name: 'Before' }, response);

      expect(createSnapshot).toHaveBeenCalledWith(TOKEN, BOARD_ID, 'Before');
      expect(answer).toEqual(saved);
      expect(headers.Location).toBe(`/public/v1/boards/${BOARD_ID}/snapshots/${SNAPSHOT_ID}`);
    });

    it('saves without a name for no body, an empty one or a null name', async () => {
      const createSnapshot = vi
        .fn()
        .mockResolvedValue(snapshot(SNAPSHOT_ID, '2026-10-01T11:00:00Z'));
      const controller = new PublicSnapshotsController(backendWith({ createSnapshot }));

      for (const body of [undefined, null, {}, { name: null }]) {
        await controller.create(TOKEN, BOARD_ID, body, responseRecorder().response);
      }

      for (const call of createSnapshot.mock.calls)
        expect(call).toEqual([TOKEN, BOARD_ID, undefined]);
      expect(createSnapshot).toHaveBeenCalledTimes(4);
    });

    it('refuses a name that is not text (400), without asking the backend', async () => {
      const createSnapshot = vi.fn();
      const controller = new PublicSnapshotsController(backendWith({ createSnapshot }));

      await expect(
        controller.create(TOKEN, BOARD_ID, { name: 3 }, responseRecorder().response),
      ).rejects.toThrow("A version's name is text.");
      expect(createSnapshot).not.toHaveBeenCalled();
    });

    it("passes the backend's refusal on (404 for a foreign board)", async () => {
      const controller = new PublicSnapshotsController(
        backendWith({ createSnapshot: vi.fn().mockRejectedValue(new NotFoundException()) }),
      );

      await expect(
        controller.create(TOKEN, BOARD_ID, {}, responseRecorder().response),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('get', () => {
    it("reads the version and its stored state with the caller's token, as a scene", async () => {
      const kept = snapshot(SNAPSHOT_ID, '2026-10-01T11:00:00Z');
      const doc = new Y.Doc();
      doc.getMap('elements').set('n', { id: 'n', type: 'text', index: 'a0', text: 'Hi' });
      const listSnapshots = vi.fn().mockResolvedValue([kept]);
      const readSnapshotDocument = vi.fn().mockResolvedValue(Y.encodeStateAsUpdate(doc));
      const controller = new PublicSnapshotsController(
        backendWith({ listSnapshots, readSnapshotDocument }),
      );

      const answer = await controller.get(TOKEN, BOARD_ID, SNAPSHOT_ID);

      expect(listSnapshots).toHaveBeenCalledWith(TOKEN, BOARD_ID);
      expect(readSnapshotDocument).toHaveBeenCalledWith(TOKEN, BOARD_ID, SNAPSHOT_ID);
      expect(answer).toEqual({
        ...kept,
        scene: {
          type: 'excalidraw',
          version: 2,
          source: 'elysion',
          elements: [{ id: 'n', type: 'text', index: 'a0', text: 'Hi' }],
          appState: {},
          files: {},
        },
      });
    });

    it('answers an unknown version 404 without reading any state', async () => {
      const readSnapshotDocument = vi.fn();
      const controller = new PublicSnapshotsController(
        backendWith({
          listSnapshots: vi.fn().mockResolvedValue([snapshot('other', '2026-10-01T11:00:00Z')]),
          readSnapshotDocument,
        }),
      );

      await expect(controller.get(TOKEN, BOARD_ID, SNAPSHOT_ID)).rejects.toThrow(NotFoundException);
      expect(readSnapshotDocument).not.toHaveBeenCalled();
    });

    it("passes the backend's refusals on (404 for a foreign board, 503 when the store is down)", async () => {
      const foreign = new PublicSnapshotsController(
        backendWith({ listSnapshots: vi.fn().mockRejectedValue(new NotFoundException()) }),
      );
      await expect(foreign.get(TOKEN, BOARD_ID, SNAPSHOT_ID)).rejects.toThrow(NotFoundException);

      const down = new ServiceUnavailableException();
      const unavailable = new PublicSnapshotsController(
        backendWith({
          listSnapshots: vi.fn().mockResolvedValue([snapshot(SNAPSHOT_ID, '2026-10-01T11:00:00Z')]),
          readSnapshotDocument: vi.fn().mockRejectedValue(down),
        }),
      );
      await expect(unavailable.get(TOKEN, BOARD_ID, SNAPSHOT_ID)).rejects.toBe(down);
    });
  });
});
