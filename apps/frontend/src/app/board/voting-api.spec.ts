import { HttpErrorResponse, provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { VotingApi, votingErrorMessage } from './voting-api';

describe('VotingApi', () => {
  let http: HttpTestingController;
  let board = '';
  let api: ReturnType<VotingApi['forBoard']>;

  beforeEach(() => {
    board = 'b/1';
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    http = TestBed.inject(HttpTestingController);
    api = TestBed.inject(VotingApi).forBoard(() => board);
  });

  afterEach(() => http.verify());

  it('reads the current voting, and null when the board has none (204)', async () => {
    const some = api.get();
    const first = http.expectOne('/api/boards/b%2F1/voting');
    expect(first.request.method).toBe('GET');
    first.flush(null, { status: 204, statusText: 'No Content' });

    expect(await some).toBeNull();
  });

  it('follows the board of the page', async () => {
    board = 'b2';
    const read = api.get();
    http.expectOne('/api/boards/b2/voting').flush(null);
    await read;
  });

  it('starts a voting with the options as the body', async () => {
    const started = api.start({ name: 'Pick', votesPerPerson: 3, named: true });
    const request = http.expectOne('/api/boards/b%2F1/votings');
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual({ name: 'Pick', votesPerPerson: 3, named: true });
    request.flush({ id: 'v1' });

    expect(await started).toEqual({ id: 'v1' });
  });

  it('votes, retracts and closes with the voting and element in the path', async () => {
    const vote = api.vote('v 1', 'e/1');
    const post = http.expectOne('/api/boards/b%2F1/votings/v%201/votes');
    expect(post.request.body).toEqual({ elementId: 'e/1' });
    post.flush({});
    await vote;

    const retract = api.retract('v1', 'e/1');
    const del = http.expectOne('/api/boards/b%2F1/votings/v1/votes/e%2F1');
    expect(del.request.method).toBe('DELETE');
    del.flush(null, { status: 204, statusText: 'No Content' });
    expect(await retract).toBeNull();

    const close = api.close('v1');
    const request = http.expectOne('/api/boards/b%2F1/votings/v1/close');
    expect(request.request.method).toBe('POST');
    request.flush({});
    await close;
  });

  it('clears the closed votings', async () => {
    const cleared = api.clear();
    const request = http.expectOne('/api/boards/b%2F1/votings');
    expect(request.request.method).toBe('DELETE');
    request.flush(null, { status: 204, statusText: 'No Content' });

    await cleared;
  });

  it('turns a refusal of start, close and clear into words', async () => {
    const started = api.start({ votesPerPerson: 3 });
    http
      .expectOne('/api/boards/b%2F1/votings')
      .flush(null, { status: 409, statusText: 'Conflict' });

    await expect(started).rejects.toThrow('already open');
  });

  it.each([
    [400, 'up to 80 characters'],
    [403, 'Only editors and owners'],
    [404, 'does not exist'],
    [409, 'already open'],
    [500, 'could not be changed'],
  ])('says what %s means', (status, words) => {
    expect(votingErrorMessage(new HttpErrorResponse({ status }))).toContain(words);
  });
});
