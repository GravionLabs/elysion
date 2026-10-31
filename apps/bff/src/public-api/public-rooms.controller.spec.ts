import { NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import type { BusinessBackendClient, Room } from '../boards/business-backend.client.js';
import { PublicRoomsController } from './public-rooms.controller.js';

const TOKEN = `elp_${'r'.repeat(43)}`;
const ROOM_ID = '0192f7a4-7a11-7d42-8e60-3b5c7d9e1f20';

const room = (id: string, createdAt: string, role: Room['role'] = 'Editor'): Room => ({
  id,
  name: `Room ${id}`,
  createdAt,
  role,
});

const backendWith = (calls: Partial<Record<keyof BusinessBackendClient, unknown>>) =>
  calls as unknown as BusinessBackendClient;

describe('PublicRoomsController', () => {
  it("lists with the caller's token, newest first, a page at a time", async () => {
    const listRooms = vi
      .fn()
      .mockResolvedValue([
        room('r1', '2026-09-01T08:00:00Z'),
        room('r3', '2026-09-03T08:00:00Z', 'Owner'),
        room('r2', '2026-09-02T08:00:00Z', 'Viewer'),
      ]);
    const controller = new PublicRoomsController(backendWith({ listRooms }));

    const first = await controller.list(TOKEN, undefined, '2');
    const second = await controller.list(TOKEN, first.next, '2');

    expect(listRooms).toHaveBeenCalledWith(TOKEN);
    expect(first.items).toEqual([
      room('r3', '2026-09-03T08:00:00Z', 'Owner'),
      room('r2', '2026-09-02T08:00:00Z', 'Viewer'),
    ]);
    expect(second).toEqual({ items: [room('r1', '2026-09-01T08:00:00Z')], next: null });
  });

  it('refuses a bad cursor (400)', async () => {
    const controller = new PublicRoomsController(
      backendWith({ listRooms: vi.fn().mockResolvedValue([]) }),
    );

    await expect(controller.list(TOKEN, 'bogus')).rejects.toMatchObject({ status: 400 });
  });

  it("reads one room of the caller's rooms with the caller's token", async () => {
    const listRooms = vi.fn().mockResolvedValue([room(ROOM_ID, '2026-09-01T08:00:00Z')]);
    const controller = new PublicRoomsController(backendWith({ listRooms }));

    expect(await controller.get(TOKEN, ROOM_ID)).toEqual(room(ROOM_ID, '2026-09-01T08:00:00Z'));
    expect(listRooms).toHaveBeenCalledWith(TOKEN);
  });

  it('answers a room the caller has no role in 404', async () => {
    const controller = new PublicRoomsController(
      backendWith({
        listRooms: vi.fn().mockResolvedValue([room('other', '2026-09-01T08:00:00Z')]),
      }),
    );

    await expect(controller.get(TOKEN, ROOM_ID)).rejects.toThrow(NotFoundException);
  });
});
