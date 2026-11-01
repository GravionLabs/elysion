import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  NotFoundException,
} from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { boardEtag, ifMatchAccepts } from './public-boards.controller.js';
import { isPublicApiRequest, problemOf } from './problem-details.js';

describe('problemOf', () => {
  it('gives the status, its standard title and the message as detail', () => {
    expect(problemOf(new BadRequestException('limit must be a whole number.'))).toEqual({
      type: 'about:blank',
      title: 'Bad Request',
      status: 400,
      detail: 'limit must be a whole number.',
    });
  });

  it('leaves out a detail that only repeats the title', () => {
    expect(problemOf(new NotFoundException())).toEqual({
      type: 'about:blank',
      title: 'Not Found',
      status: 404,
    });
  });

  it("keeps Elysion's code, so a client can tell a deactivated owner from a missing scope", () => {
    const deactivated = new ForbiddenException({
      statusCode: 403,
      message: 'This account has been deactivated.',
      code: 'account-deactivated',
    });

    expect(problemOf(deactivated)).toMatchObject({ status: 403, code: 'account-deactivated' });
  });

  it('joins a list of messages', () => {
    expect(problemOf(new BadRequestException(['a.', 'b.'])).detail).toBe('a. b.');
  });

  it('says nothing about an error that is no HTTP error (500)', () => {
    expect(problemOf(new Error('connection string postgres://secret'))).toEqual({
      type: 'about:blank',
      title: 'Internal Server Error',
      status: 500,
    });
  });

  it('knows the statuses of the API', () => {
    expect(problemOf(new HttpException('x', 428)).title).toBe('Precondition Required');
    expect(problemOf(new HttpException('x', 429)).title).toBe('Too Many Requests');
  });
});

describe('isPublicApiRequest', () => {
  it('is true under /public/ only', () => {
    expect(isPublicApiRequest({ originalUrl: '/public/v1/boards?x=1' })).toBe(true);
    expect(isPublicApiRequest({ originalUrl: '/api/boards' })).toBe(false);
    expect(isPublicApiRequest({ originalUrl: '/publicity' })).toBe(false);
  });
});

describe('the ETag of a board', () => {
  const board = { id: 'b1', name: 'Retro', createdAt: '2026-10-01T00:00:00Z', roomId: null };

  it('changes with the name and the room, and not with what the caller sees of it', () => {
    const etag = boardEtag(board);

    expect(etag).toMatch(/^"[A-Za-z0-9_-]{27}"$/);
    expect(boardEtag({ ...board, isFavorite: true, lastOpenedAt: '2026-10-31T00:00:00Z' })).toBe(
      etag,
    );
    expect(boardEtag({ ...board, name: 'Retro 2' })).not.toBe(etag);
    expect(boardEtag({ ...board, roomId: 'r1' })).not.toBe(etag);
  });

  it('is accepted by If-Match alone, in a list or as *, and a weak one is not', () => {
    const etag = boardEtag(board);

    expect(ifMatchAccepts(etag, etag)).toBe(true);
    expect(ifMatchAccepts(`"x", ${etag}`, etag)).toBe(true);
    expect(ifMatchAccepts('*', etag)).toBe(true);
    expect(ifMatchAccepts(`W/${etag}`, etag)).toBe(false);
    expect(ifMatchAccepts('"other"', etag)).toBe(false);
  });
});
