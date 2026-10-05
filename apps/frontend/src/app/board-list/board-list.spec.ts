import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { BoardInfo } from '../board/board-api';
import { BoardList } from './board-list';

const board = (id: string, name: string, createdAt = '2026-10-05T10:00:00Z'): BoardInfo => ({
  id,
  name,
  createdAt,
  path: `/board/${id}`,
});

describe('BoardList', () => {
  let fixture: ComponentFixture<BoardList>;
  let http: HttpTestingController;
  let router: Router;
  const el = () => fixture.nativeElement as HTMLElement;
  const text = () => el().textContent ?? '';
  const click = async (selector: string) => {
    (el().querySelector(selector) as HTMLElement).click();
    await fixture.whenStable();
  };
  const type = async (value: string) => {
    const input = el().querySelector('input') as HTMLInputElement;
    input.value = value;
    input.dispatchEvent(new Event('input'));
    await fixture.whenStable();
  };
  const submit = async () => {
    (el().querySelector('form') as HTMLFormElement).dispatchEvent(new Event('submit'));
    await fixture.whenStable();
  };

  beforeEach(async () => {
    localStorage.clear();
    await TestBed.configureTestingModule({
      imports: [BoardList],
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
    http = TestBed.inject(HttpTestingController);
    router = TestBed.inject(Router);
    fixture = TestBed.createComponent(BoardList);
    await fixture.whenStable();
  });

  afterEach(() => http.verify());

  const respondWith = async (boards: BoardInfo[]) => {
    http.expectOne('/api/boards').flush(boards);
    await fixture.whenStable();
  };

  it('says it is loading until the boards arrive', () => {
    expect(el().querySelector('[role="status"]')?.textContent).toContain('Loading boards');
    http.expectOne('/api/boards').flush([]);
  });

  it('lists the boards in the order the API sent them, each linking to its board', async () => {
    await respondWith([board('b2', 'Sprint review'), board('b1', 'Retro')]);

    const cards = [...el().querySelectorAll('a.board-card')] as HTMLAnchorElement[];
    expect(cards.map((card) => card.querySelector('.board-name')?.textContent)).toEqual([
      'Sprint review',
      'Retro',
    ]);
    expect(cards.map((card) => card.getAttribute('href'))).toEqual(['/board/b2', '/board/b1']);
    expect(cards[0].textContent).toContain('Oct 5, 2026');
  });

  it('shows an empty state with a way to create the first board', async () => {
    await respondWith([]);

    expect(text()).toContain('No boards yet');
    expect(el().querySelector('.boards')).toBeNull();
    expect((el().querySelector('.new-board') as HTMLElement).textContent).toContain(
      'Create your first board',
    );
  });

  it('shows an error with a retry when the boards cannot be loaded', async () => {
    http.expectOne('/api/boards').flush('', { status: 502, statusText: 'Bad Gateway' });
    await fixture.whenStable();

    expect(el().querySelector('[role="alert"]')?.textContent).toContain('could not be loaded');

    await click('.message.error button');
    await respondWith([board('b1', 'Retro')]);

    expect(text()).toContain('Retro');
    expect(el().querySelector('[role="alert"]')).toBeNull();
  });

  describe('creating a board', () => {
    beforeEach(async () => {
      await respondWith([board('b1', 'Retro')]);
      await click('.new-board');
    });

    it('asks for a name in an inline field, preset to "Untitled board" and focused', () => {
      const input = el().querySelector('input') as HTMLInputElement;

      expect(input.value).toBe('Untitled board');
      expect(input.maxLength).toBe(120);
      expect(document.activeElement).toBe(input);
    });

    it('creates the board with the typed name and opens it', async () => {
      const navigate = vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);

      await type('  Q3 planning  ');
      await submit();

      const request = http.expectOne('/api/boards');
      expect(request.request.method).toBe('POST');
      expect(request.request.body).toEqual({ name: 'Q3 planning' });
      expect(text()).toContain('Creating…');
      request.flush(board('b9', 'Q3 planning'));
      await fixture.whenStable();

      expect(navigate).toHaveBeenCalledWith('/board/b9');
    });

    it('does not create a board without a name', async () => {
      await type('   ');
      await submit();

      http.expectNone('/api/boards');
      expect(el().querySelector('[role="alert"]')?.textContent).toContain('Give the board a name');
      expect(el().querySelector('input')?.getAttribute('aria-invalid')).toBe('true');
    });

    it('keeps the form and says so when the board cannot be created, and lets the user retry', async () => {
      await submit();
      http.expectOne('/api/boards').flush('', { status: 502, statusText: 'Bad Gateway' });
      await fixture.whenStable();

      expect(el().querySelector('[role="alert"]')?.textContent).toContain('could not be created');
      expect((el().querySelector('input') as HTMLInputElement).value).toBe('Untitled board');
      expect((el().querySelector('button[type="submit"]') as HTMLButtonElement).disabled).toBe(
        false,
      );
    });

    it('closes the form on Cancel and on Escape without creating anything', async () => {
      await click('button[type="button"]:not(.new-board)');
      expect(el().querySelector('form')).toBeNull();

      await click('.new-board');
      (el().querySelector('input') as HTMLInputElement).dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape' }),
      );
      await fixture.whenStable();

      expect(el().querySelector('form')).toBeNull();
      http.expectNone('/api/boards');
    });
  });

  describe('deleting a board', () => {
    beforeEach(async () => {
      await respondWith([board('b2', 'Sprint review'), board('b1', 'Retro')]);
    });

    const askToDelete = async (name: string) => {
      (el().querySelector(`button[aria-label="Delete the board ${name}"]`) as HTMLElement).click();
      await fixture.whenStable();
    };
    const confirm = () => el().querySelector('[role="alertdialog"]') as HTMLElement | null;
    const confirmButton = (selector: string) =>
      (confirm() as HTMLElement).querySelector(selector) as HTMLElement;
    const names = () =>
      [...el().querySelectorAll('.board-name')].map((name) => name.textContent?.trim());

    it('offers a labelled Delete next to every board, not inside its link', () => {
      const buttons = [...el().querySelectorAll('.delete-button')];

      expect(buttons.map((b) => b.getAttribute('aria-label'))).toEqual([
        'Delete the board Sprint review',
        'Delete the board Retro',
      ]);
      expect(buttons.every((b) => !b.closest('a'))).toBe(true);
    });

    it('asks first, in the page, and names the board; nothing is sent yet', async () => {
      await askToDelete('Retro');

      expect(confirm()?.textContent).toContain('Delete “Retro”?');
      expect(confirm()?.textContent).toContain('cannot be undone');
      http.expectNone(() => true);
      expect(names()).toEqual(['Sprint review', 'Retro']);
    });

    it('deletes only the chosen board once confirmed', async () => {
      await askToDelete('Retro');

      confirmButton('.danger').click();
      await fixture.whenStable();
      const request = http.expectOne('/api/boards/b1');
      expect(request.request.method).toBe('DELETE');
      expect(confirm()?.textContent).toContain('Deleting…');
      request.flush(null, { status: 204, statusText: 'No Content' });
      await fixture.whenStable();

      expect(names()).toEqual(['Sprint review']);
      expect(confirm()).toBeNull();
    });

    it('does nothing on Cancel', async () => {
      await askToDelete('Retro');

      confirmButton('button:not(.danger)').click();
      await fixture.whenStable();

      http.expectNone(() => true);
      expect(confirm()).toBeNull();
      expect(names()).toEqual(['Sprint review', 'Retro']);
    });

    it('keeps the board and says so when deleting fails, and lets the user try again', async () => {
      await askToDelete('Retro');
      confirmButton('.danger').click();
      await fixture.whenStable();
      http.expectOne('/api/boards/b1').flush('', { status: 502, statusText: 'Bad Gateway' });
      await fixture.whenStable();

      expect(confirm()?.textContent).toContain('could not be deleted');
      expect(names()).toEqual(['Sprint review', 'Retro']);

      confirmButton('.danger').click();
      await fixture.whenStable();
      http.expectOne('/api/boards/b1').flush(null, { status: 204, statusText: 'No Content' });
      await fixture.whenStable();

      expect(names()).toEqual(['Sprint review']);
    });

    it('shows the empty state after the last board is deleted', async () => {
      await askToDelete('Retro');
      confirmButton('.danger').click();
      await fixture.whenStable();
      http.expectOne('/api/boards/b1').flush(null, { status: 204, statusText: 'No Content' });
      await fixture.whenStable();
      await askToDelete('Sprint review');
      confirmButton('.danger').click();
      await fixture.whenStable();
      http.expectOne('/api/boards/b2').flush(null, { status: 204, statusText: 'No Content' });
      await fixture.whenStable();

      expect(text()).toContain('No boards yet');
    });
  });
});
