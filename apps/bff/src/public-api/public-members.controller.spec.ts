import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import type { BoardMember, BusinessBackendClient } from '../boards/business-backend.client.js';
import {
  PublicBoardMembersController,
  PublicRoomMembersController,
} from './public-members.controller.js';

const TOKEN = `elp_${'m'.repeat(43)}`;
const ID = '0192f7a5-6c1d-7e2f-8a3b-4c5d6e7f8a9b';
const USER_A = '00000000-0000-4000-8000-00000000000a';
const USER_B = '00000000-0000-4000-8000-00000000000b';

const member = (userId: string, role: BoardMember['role']): BoardMember => ({
  userId,
  displayName: userId === USER_A ? 'Ada' : 'Bob',
  email: null,
  role,
});

const backendWith = (calls: Partial<Record<keyof BusinessBackendClient, unknown>>) =>
  calls as unknown as BusinessBackendClient;

/** The board and the room controller are the same over different backend calls. */
const variants = [
  {
    name: 'PublicBoardMembersController',
    make: (backend: BusinessBackendClient) => new PublicBoardMembersController(backend),
    calls: {
      list: 'listMembers',
      add: 'addMember',
      change: 'changeMemberRole',
      remove: 'removeMember',
    },
  },
  {
    name: 'PublicRoomMembersController',
    make: (backend: BusinessBackendClient) => new PublicRoomMembersController(backend),
    calls: {
      list: 'listRoomMembers',
      add: 'addRoomMember',
      change: 'changeRoomMemberRole',
      remove: 'removeRoomMember',
    },
  },
] as const;

for (const { name, make, calls } of variants) {
  describe(name, () => {
    it("lists with the caller's token, by user id, a page at a time", async () => {
      const list = vi.fn().mockResolvedValue([member(USER_B, 'Viewer'), member(USER_A, 'Owner')]);
      const controller = make(backendWith({ [calls.list]: list }));

      const first = await controller.list(TOKEN, ID, undefined, '1');
      const second = await controller.list(TOKEN, ID, first.next, '1');

      expect(list).toHaveBeenCalledWith(TOKEN, ID);
      expect(first.items).toEqual([member(USER_A, 'Owner')]);
      expect(first.next).toEqual(expect.any(String));
      expect(second).toEqual({ items: [member(USER_B, 'Viewer')], next: null });
    });

    it('answers a missing email as null', async () => {
      const { email: _email, ...withoutEmail } = member(USER_A, 'Owner');
      const controller = make(
        backendWith({ [calls.list]: vi.fn().mockResolvedValue([withoutEmail]) }),
      );

      const page = await controller.list(TOKEN, ID);

      expect(page.items).toEqual([member(USER_A, 'Owner')]);
    });

    it("passes the backend's 404 on for a board or room the caller has no role on", async () => {
      const controller = make(
        backendWith({ [calls.list]: vi.fn().mockRejectedValue(new NotFoundException()) }),
      );

      await expect(controller.list(TOKEN, ID)).rejects.toThrow(NotFoundException);
    });

    it("adds by email or by id with the caller's token", async () => {
      const add = vi.fn().mockResolvedValue({ ...member(USER_B, 'Editor'), extra: 'dropped' });
      const controller = make(backendWith({ [calls.add]: add }));

      const byEmail = await controller.add(TOKEN, ID, { email: 'bob@example.com', role: 'Editor' });
      await controller.add(TOKEN, ID, { userId: USER_B, role: 'Viewer' });

      expect(add).toHaveBeenNthCalledWith(1, TOKEN, ID, { email: 'bob@example.com' }, 'Editor');
      expect(add).toHaveBeenNthCalledWith(2, TOKEN, ID, { userId: USER_B }, 'Viewer');
      expect(byEmail).toEqual(member(USER_B, 'Editor'));
    });

    it('refuses a body without a person or a role (400), without asking the backend', async () => {
      const add = vi.fn();
      const controller = make(backendWith({ [calls.add]: add }));

      await expect(controller.add(TOKEN, ID, { role: 'Editor' })).rejects.toThrow(
        'A member needs an email or a userId.',
      );
      await expect(controller.add(TOKEN, ID, { email: 'bob@example.com' })).rejects.toThrow(
        BadRequestException,
      );
      expect(add).not.toHaveBeenCalled();
    });

    it("changes a role with the caller's token", async () => {
      const change = vi.fn().mockResolvedValue(member(USER_B, 'Viewer'));
      const controller = make(backendWith({ [calls.change]: change }));

      const changed = await controller.change(TOKEN, ID, USER_B, { role: 'Viewer' });

      expect(change).toHaveBeenCalledWith(TOKEN, ID, USER_B, 'Viewer');
      expect(changed).toEqual(member(USER_B, 'Viewer'));
    });

    it('refuses a change without a role (400), without asking the backend', async () => {
      const change = vi.fn();
      const controller = make(backendWith({ [calls.change]: change }));

      await expect(controller.change(TOKEN, ID, USER_B, {})).rejects.toThrow(BadRequestException);
      expect(change).not.toHaveBeenCalled();
    });

    it("removes with the caller's token, and passes the backend's rules on (409 for the last owner)", async () => {
      const remove = vi.fn().mockResolvedValue(undefined);
      const controller = make(backendWith({ [calls.remove]: remove }));
      await controller.remove(TOKEN, ID, USER_B);
      expect(remove).toHaveBeenCalledWith(TOKEN, ID, USER_B);

      const lastOwner = new ConflictException('A board needs an owner.');
      const refusing = make(backendWith({ [calls.remove]: vi.fn().mockRejectedValue(lastOwner) }));
      await expect(refusing.remove(TOKEN, ID, USER_A)).rejects.toBe(lastOwner);
    });
  });
}
