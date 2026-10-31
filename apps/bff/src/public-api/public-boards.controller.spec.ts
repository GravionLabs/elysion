import { PassThrough, Readable } from 'node:stream';
import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  NotFoundException,
} from '@nestjs/common';
import type { Response } from 'express';
import { describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import type { Board, BusinessBackendClient } from '../boards/business-backend.client.js';
import { PublicBoardsController, boardEtag } from './public-boards.controller.js';

const TOKEN = `elp_${'a'.repeat(43)}`;
const BOARD_ID = '0192f7a5-6c1d-7e2f-8a3b-4c5d6e7f8a9b';
const ROOM_ID = '0192f7a4-7a11-7d42-8e60-3b5c7d9e1f20';

const board = (overrides: Partial<Board> = {}): Board => ({
  id: BOARD_ID,
  name: 'Retro',
  createdAt: '2026-10-01T10:00:00Z',
  roomId: null,
  lastOpenedAt: '2026-10-30T10:00:00Z',
  hasThumbnail: true,
  ...overrides,
});

/** The business backend as the controller sees it: every call a mock. */
function backendWith(calls: Partial<Record<keyof BusinessBackendClient, unknown>>) {
  return calls as unknown as BusinessBackendClient;
}

/** The headers a handler sets on its answer. */
function responseRecorder() {
  const headers: Record<string, string> = {};
  const response = {
    setHeader: (name: string, value: string) => {
      headers[name] = value;
    },
  } as unknown as Response;
  return { headers, response };
}

describe('PublicBoardsController', () => {
  describe('list', () => {
    it("asks the backend with the caller's token and answers the public fields, newest first, a page at a time", async () => {
      const listBoards = vi
        .fn()
        .mockResolvedValue([
          board({ id: 'b1', name: 'Old', createdAt: '2026-10-01T10:00:00Z' }),
          board({ id: 'b3', name: 'New', createdAt: '2026-10-03T10:00:00Z', roomId: ROOM_ID }),
          board({ id: 'b2', name: 'Middle', createdAt: '2026-10-02T10:00:00Z' }),
        ]);
      const controller = new PublicBoardsController(backendWith({ listBoards }));

      const first = await controller.list(TOKEN, undefined, '2');
      const second = await controller.list(TOKEN, first.next, '2');

      expect(listBoards).toHaveBeenCalledWith(TOKEN);
      expect(first.items).toEqual([
        { id: 'b3', name: 'New', createdAt: '2026-10-03T10:00:00Z', roomId: ROOM_ID },
        { id: 'b2', name: 'Middle', createdAt: '2026-10-02T10:00:00Z', roomId: null },
      ]);
      expect(first.next).toEqual(expect.any(String));
      expect(second).toEqual({
        items: [{ id: 'b1', name: 'Old', createdAt: '2026-10-01T10:00:00Z', roomId: null }],
        next: null,
      });
    });

    it('keeps only the boards of a room with roomId', async () => {
      const listBoards = vi
        .fn()
        .mockResolvedValue([board({ id: 'b1' }), board({ id: 'b2', roomId: ROOM_ID })]);
      const controller = new PublicBoardsController(backendWith({ listBoards }));

      const page = await controller.list(TOKEN, undefined, undefined, ROOM_ID);

      expect(page.items.map((item) => item.id)).toEqual(['b2']);
    });

    it('refuses a roomId that is not an id without asking the backend', async () => {
      const listBoards = vi.fn();
      const controller = new PublicBoardsController(backendWith({ listBoards }));

      await expect(controller.list(TOKEN, undefined, undefined, 'nope')).rejects.toThrow(
        BadRequestException,
      );
      expect(listBoards).not.toHaveBeenCalled();
    });

    it('refuses a bad limit (400)', async () => {
      const controller = new PublicBoardsController(
        backendWith({ listBoards: vi.fn().mockResolvedValue([]) }),
      );

      await expect(controller.list(TOKEN, undefined, '0')).rejects.toThrow(BadRequestException);
    });
  });

  describe('create', () => {
    it("creates with the caller's token and answers the board, its address and its ETag", async () => {
      const created = board({ name: 'From a script' });
      const createBoard = vi.fn().mockResolvedValue(created);
      const controller = new PublicBoardsController(backendWith({ createBoard }));
      const { headers, response } = responseRecorder();

      const answer = await controller.create(TOKEN, { name: 'From a script' }, response);

      expect(createBoard).toHaveBeenCalledWith(TOKEN, 'From a script');
      expect(answer).toEqual({
        id: BOARD_ID,
        name: 'From a script',
        createdAt: '2026-10-01T10:00:00Z',
        roomId: null,
      });
      expect(headers.Location).toBe(`/public/v1/boards/${BOARD_ID}`);
      expect(headers.ETag).toBe(boardEtag(created));
    });

    it('refuses a body without a name as text, without asking the backend', async () => {
      const createBoard = vi.fn();
      const controller = new PublicBoardsController(backendWith({ createBoard }));

      for (const body of [null, {}, { name: 3 }]) {
        await expect(controller.create(TOKEN, body, responseRecorder().response)).rejects.toThrow(
          'A board needs a name, as text.',
        );
      }
      expect(createBoard).not.toHaveBeenCalled();
    });

    it("passes the backend's refusal on", async () => {
      const refusal = new BadRequestException('The name must be between 1 and 120 characters.');
      const controller = new PublicBoardsController(
        backendWith({ createBoard: vi.fn().mockRejectedValue(refusal) }),
      );

      await expect(
        controller.create(TOKEN, { name: '' }, responseRecorder().response),
      ).rejects.toBe(refusal);
    });
  });

  describe('get', () => {
    it("reads with the caller's token and answers the public fields with the ETag", async () => {
      const found = board({ roomId: ROOM_ID });
      const getBoard = vi.fn().mockResolvedValue(found);
      const controller = new PublicBoardsController(backendWith({ getBoard }));
      const { headers, response } = responseRecorder();

      const answer = await controller.get(TOKEN, BOARD_ID, response);

      expect(getBoard).toHaveBeenCalledWith(TOKEN, BOARD_ID);
      expect(answer).toEqual({
        id: BOARD_ID,
        name: 'Retro',
        createdAt: '2026-10-01T10:00:00Z',
        roomId: ROOM_ID,
      });
      expect(headers.ETag).toMatch(/^"[A-Za-z0-9_-]{27}"$/);
    });

    it("passes the backend's 404 for a board the caller has no role on", async () => {
      const controller = new PublicBoardsController(
        backendWith({ getBoard: vi.fn().mockRejectedValue(new NotFoundException()) }),
      );

      await expect(controller.get(TOKEN, BOARD_ID, responseRecorder().response)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('rename', () => {
    const renameSetup = () => {
      const current = board();
      const renamed = board({ name: 'Retro (done)' });
      const getBoard = vi.fn().mockResolvedValue(current);
      const renameBoard = vi.fn().mockResolvedValue(renamed);
      const controller = new PublicBoardsController(backendWith({ getBoard, renameBoard }));
      return { current, renamed, getBoard, renameBoard, controller };
    };

    it("renames with the caller's token when If-Match names the current ETag, and answers the new one", async () => {
      const { current, renamed, getBoard, renameBoard, controller } = renameSetup();
      const { headers, response } = responseRecorder();

      const answer = await controller.rename(
        TOKEN,
        BOARD_ID,
        boardEtag(current),
        { name: 'Retro (done)' },
        response,
      );

      expect(getBoard).toHaveBeenCalledWith(TOKEN, BOARD_ID);
      expect(renameBoard).toHaveBeenCalledWith(TOKEN, BOARD_ID, 'Retro (done)');
      expect(answer.name).toBe('Retro (done)');
      expect(headers.ETag).toBe(boardEtag(renamed));
      expect(headers.ETag).not.toBe(boardEtag(current));
    });

    it('takes If-Match: *', async () => {
      const { renameBoard, controller } = renameSetup();

      await controller.rename(TOKEN, BOARD_ID, '*', { name: 'x' }, responseRecorder().response);

      expect(renameBoard).toHaveBeenCalledWith(TOKEN, BOARD_ID, 'x');
    });

    it('needs If-Match (428), before the backend is asked', async () => {
      const { getBoard, renameBoard, controller } = renameSetup();

      for (const ifMatch of [undefined, ' ']) {
        const error = await controller
          .rename(TOKEN, BOARD_ID, ifMatch, { name: 'x' }, responseRecorder().response)
          .catch((caught: unknown) => caught);
        expect((error as HttpException).getStatus()).toBe(HttpStatus.PRECONDITION_REQUIRED);
      }
      expect(getBoard).not.toHaveBeenCalled();
      expect(renameBoard).not.toHaveBeenCalled();
    });

    it('refuses an old ETag (412) and changes nothing', async () => {
      const { renameBoard, controller } = renameSetup();

      const error = await controller
        .rename(TOKEN, BOARD_ID, '"old"', { name: 'x' }, responseRecorder().response)
        .catch((caught: unknown) => caught);

      expect((error as HttpException).getStatus()).toBe(HttpStatus.PRECONDITION_FAILED);
      expect((error as HttpException).message).toBe(
        'The board changed since it was read: read it again.',
      );
      expect(renameBoard).not.toHaveBeenCalled();
    });

    it('is 404 for a board the caller has no role on, before any change', async () => {
      const renameBoard = vi.fn();
      const controller = new PublicBoardsController(
        backendWith({ getBoard: vi.fn().mockRejectedValue(new NotFoundException()), renameBoard }),
      );

      await expect(
        controller.rename(TOKEN, BOARD_ID, '*', { name: 'x' }, responseRecorder().response),
      ).rejects.toThrow(NotFoundException);
      expect(renameBoard).not.toHaveBeenCalled();
    });
  });

  describe('remove', () => {
    it("deletes with the caller's token", async () => {
      const deleteBoard = vi.fn().mockResolvedValue(undefined);
      const controller = new PublicBoardsController(backendWith({ deleteBoard }));

      await controller.remove(TOKEN, BOARD_ID);

      expect(deleteBoard).toHaveBeenCalledWith(TOKEN, BOARD_ID);
    });

    it("passes the backend's refusal on (403 for an editor, 404 for a non-member)", async () => {
      for (const refusal of [new ForbiddenException(), new NotFoundException()]) {
        const controller = new PublicBoardsController(
          backendWith({ deleteBoard: vi.fn().mockRejectedValue(refusal) }),
        );
        await expect(controller.remove(TOKEN, BOARD_ID)).rejects.toBe(refusal);
      }
    });
  });

  describe('duplicate', () => {
    it("copies with the caller's token and answers the copy with its address and ETag", async () => {
      const copy = board({ id: 'copy-id', name: 'Retro (copy)' });
      const duplicateBoard = vi.fn().mockResolvedValue(copy);
      const controller = new PublicBoardsController(backendWith({ duplicateBoard }));
      const { headers, response } = responseRecorder();

      const answer = await controller.duplicate(TOKEN, BOARD_ID, response);

      expect(duplicateBoard).toHaveBeenCalledWith(TOKEN, BOARD_ID);
      expect(answer.name).toBe('Retro (copy)');
      expect(headers.Location).toBe('/public/v1/boards/copy-id');
      expect(headers.ETag).toBe(boardEtag(copy));
    });

    it("passes the backend's 404 on", async () => {
      const controller = new PublicBoardsController(
        backendWith({ duplicateBoard: vi.fn().mockRejectedValue(new NotFoundException()) }),
      );

      await expect(
        controller.duplicate(TOKEN, BOARD_ID, responseRecorder().response),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('elements', () => {
    it("reads the stored state with the caller's token and answers it as a scene with file links", async () => {
      const doc = new Y.Doc();
      doc.getMap('elements').set('img', { id: 'img', type: 'image', index: 'a0', fileId: 'f1' });
      doc.getMap('files').set('f1', { mimeType: 'image/png', created: 1 });
      const getBoardDocument = vi.fn().mockResolvedValue(Y.encodeStateAsUpdate(doc));
      const controller = new PublicBoardsController(backendWith({ getBoardDocument }));

      const scene = await controller.elements(TOKEN, BOARD_ID);

      expect(getBoardDocument).toHaveBeenCalledWith(TOKEN, BOARD_ID);
      expect(scene.elements).toEqual([{ id: 'img', type: 'image', index: 'a0', fileId: 'f1' }]);
      expect(scene.files).toEqual({
        f1: {
          id: 'f1',
          mimeType: 'image/png',
          created: 1,
          url: `/public/v1/boards/${BOARD_ID}/files/f1`,
        },
      });
    });

    it('answers an empty scene for a board never saved', async () => {
      const controller = new PublicBoardsController(
        backendWith({ getBoardDocument: vi.fn().mockResolvedValue(null) }),
      );

      const scene = await controller.elements(TOKEN, BOARD_ID);

      expect(scene).toEqual({
        type: 'excalidraw',
        version: 2,
        source: 'elysion',
        elements: [],
        appState: {},
        files: {},
      });
    });

    it("passes the backend's 404 on", async () => {
      const controller = new PublicBoardsController(
        backendWith({ getBoardDocument: vi.fn().mockRejectedValue(new NotFoundException()) }),
      );

      await expect(controller.elements(TOKEN, BOARD_ID)).rejects.toThrow(NotFoundException);
    });
  });

  describe('file', () => {
    /** An answer the handler streams into: its status, headers and bytes. */
    function streamRecorder() {
      const sink = new PassThrough();
      const chunks: Buffer[] = [];
      sink.on('data', (chunk: Buffer) => chunks.push(chunk));
      const recorded = { status: 0, headers: {} as Record<string, string>, chunks };
      const response = Object.assign(sink, {
        status(code: number) {
          recorded.status = code;
          return response;
        },
        set(headers: Record<string, string>) {
          Object.assign(recorded.headers, headers);
          return response;
        },
      });
      return { recorded, response: response as unknown as Response };
    }

    it("streams the backend's file with the caller's token and the headers it chose", async () => {
      const getFile = vi.fn().mockResolvedValue({
        headers: { 'content-type': 'image/png', 'content-length': '2' },
        stream: Readable.from([Buffer.from([137, 80])]),
      });
      const controller = new PublicBoardsController(backendWith({ getFile }));
      const { recorded, response } = streamRecorder();

      await controller.file(TOKEN, BOARD_ID, 'f1', response);

      expect(getFile).toHaveBeenCalledWith(TOKEN, BOARD_ID, 'f1');
      expect(recorded.status).toBe(200);
      expect(recorded.headers).toEqual({ 'content-type': 'image/png', 'content-length': '2' });
      expect(Buffer.concat(recorded.chunks)).toEqual(Buffer.from([137, 80]));
    });

    it('answers a file id that cannot exist 404 without asking the backend', async () => {
      const getFile = vi.fn();
      const controller = new PublicBoardsController(backendWith({ getFile }));

      for (const fileId of ['../document', '', 'a'.repeat(129), 'a b']) {
        await expect(
          controller.file(TOKEN, BOARD_ID, fileId, streamRecorder().response),
        ).rejects.toThrow(NotFoundException);
      }
      expect(getFile).not.toHaveBeenCalled();
    });

    it("passes the backend's 404 on (a foreign board or an unknown file)", async () => {
      const controller = new PublicBoardsController(
        backendWith({ getFile: vi.fn().mockRejectedValue(new NotFoundException()) }),
      );

      await expect(
        controller.file(TOKEN, BOARD_ID, 'f1', streamRecorder().response),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
