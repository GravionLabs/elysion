import { HttpErrorResponse } from '@angular/common/http';
import { Subject } from 'rxjs';
import type { Page } from './admin-api';
import { PAGE_SIZE, PagedList, describeAdminError } from './paged-list';

const page = (items: string[], total: number, number = 1): Page<string> => ({
  items,
  total,
  page: number,
  pageSize: PAGE_SIZE,
});

describe('PagedList', () => {
  it('loads a page and knows how many pages there are', () => {
    const answer = new Subject<Page<string>>();
    const fetch = vi.fn(() => answer);
    const list = new PagedList<string>(fetch);

    list.load();
    expect(list.state()).toBe('loading');
    answer.next(page(['a', 'b'], 51));

    expect(fetch).toHaveBeenCalledWith('', 1, PAGE_SIZE);
    expect(list.items()).toEqual(['a', 'b']);
    expect(list.pages()).toBe(3);
    expect(list.state()).toBe('ready');
  });

  it('starts a new search at the first page, with the text trimmed', () => {
    const fetch = vi.fn(() => new Subject<Page<string>>());
    const list = new PagedList<string>(fetch);
    list.page.set(4);

    list.search('  ada ');

    expect(fetch).toHaveBeenCalledWith('ada', 1, PAGE_SIZE);
  });

  it('goes to a page that exists and nowhere else', () => {
    const fetch = vi.fn(
      (_query: string, _page: number, _size: number) => new Subject<Page<string>>(),
    );
    const list = new PagedList<string>(fetch);
    list.total.set(60);

    list.go(2);
    list.go(2);
    list.go(9);
    list.go(0);

    expect(fetch.mock.calls.map((call) => call[1])).toEqual([2, 3, 1]);
  });

  it('ignores the answer of a request a newer one has overtaken', () => {
    const first = new Subject<Page<string>>();
    const second = new Subject<Page<string>>();
    const answers = [first, second];
    const list = new PagedList<string>(() => answers.shift()!);

    list.load();
    list.search('x');
    second.next(page(['new'], 1));
    first.next(page(['old'], 1));

    expect(list.items()).toEqual(['new']);
  });

  it('says it failed, and recovers with the next load', () => {
    const answers = [new Subject<Page<string>>(), new Subject<Page<string>>()];
    const list = new PagedList<string>(() => answers.shift()!);
    const failing = answers[0];

    list.load();
    failing.error(new Error('down'));
    expect(list.state()).toBe('error');

    list.load();
    expect(list.state()).toBe('loading');
  });
});

describe('describeAdminError', () => {
  const failure = (status: number, error: unknown) =>
    new HttpErrorResponse({ status, error, statusText: 'x' });

  it("prefers the API's own detail, then its message", () => {
    expect(describeAdminError(failure(409, { detail: 'Taken.', message: 'm' }), 'fallback')).toBe(
      'Taken.',
    );
    expect(describeAdminError(failure(400, { message: 'Bad.' }), 'fallback')).toBe('Bad.');
  });

  it('names a refusal for a person who is not an administrator', () => {
    expect(describeAdminError(failure(403, null), 'fallback')).toBe(
      'Only an administrator can do this.',
    );
  });

  it('falls back for everything else', () => {
    expect(describeAdminError(failure(500, null), 'fallback')).toBe('fallback');
    expect(describeAdminError(new Error('x'), 'fallback')).toBe('fallback');
  });
});
