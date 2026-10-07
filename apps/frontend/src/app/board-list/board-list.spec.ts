import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { BoardInfo } from '../board/board-api';
import { RoomInfo } from '../board/room-api';
import { TemplateInfo } from '../board/template-api';
import { FAKE_USER, FakeSession, provideFakeSession } from '../auth/testing';
import { SessionService } from '../auth/session.service';
import { BoardList, boardInitials, boardTint } from './board-list';

const board = (
  id: string,
  name: string,
  createdAt = '2026-10-05T10:00:00Z',
  roomId: string | null = null,
): BoardInfo => ({
  id,
  name,
  createdAt,
  roomId,
  path: `/board/${id}`,
});

const TEMPLATES: TemplateInfo[] = [
  {
    id: 't-retro',
    name: 'Retrospective',
    description: 'Three columns.',
    isBuiltIn: true,
    createdAt: '2026-10-06T00:00:00Z',
  },
  {
    id: 't-kanban',
    name: 'Kanban',
    description: 'To do, Doing, Done.',
    isBuiltIn: true,
    createdAt: '2026-10-06T00:00:00Z',
  },
];

describe('boardInitials', () => {
  it.each([
    ['Sprint review', 'SR'],
    ['Retro', 'RE'],
    ['  q3   planning board ', 'QP'],
    ['x', 'X'],
    ['   ', '?'],
  ])('turns %j into %j', (name, initials) => {
    expect(boardInitials(name)).toBe(initials);
  });
});

describe('boardTint', () => {
  it('is stable for a board and always one of the node tokens', () => {
    expect(boardTint('b1')).toBe(boardTint('b1'));
    expect(boardTint('some-guid')).toMatch(/^var\(--c-node-[a-z]+\)$/);
  });

  it('differs between boards', () => {
    const tints = new Set(['a', 'b', 'c', 'd', 'e'].map(boardTint));
    expect(tints.size).toBeGreaterThan(1);
  });
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
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        provideFakeSession(),
      ],
    }).compileComponents();
    http = TestBed.inject(HttpTestingController);
    router = TestBed.inject(Router);
    fixture = TestBed.createComponent(BoardList);
    await fixture.whenStable();
  });

  afterEach(() => http.verify());

  /** Answers the two requests the page makes when it loads: the boards and the rooms. */
  const respondWith = async (boards: BoardInfo[], rooms: RoomInfo[] = []) => {
    http.expectOne('/api/boards').flush(boards);
    http.expectOne('/api/rooms').flush(rooms);
    await fixture.whenStable();
  };

  it('says it is loading until the boards arrive', () => {
    expect(el().querySelector('.message[role="status"]')?.textContent).toContain('Loading boards');
    http.expectOne('/api/boards').flush([]);
    http.expectOne('/api/rooms').flush([]);
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

  describe('a board card', () => {
    beforeEach(async () => {
      await respondWith([
        board('b2', 'Sprint review'),
        board('b1', 'Q3 planning with the whole team'),
      ]);
    });

    it('is one link with a preview, the name with a title, and the date', () => {
      const items = [...el().querySelectorAll('.board-item')];

      expect(items).toHaveLength(2);
      for (const item of items) {
        expect(item.querySelectorAll('a')).toHaveLength(1);
        expect(item.querySelector('a .board-preview')).not.toBeNull();
        expect(item.querySelector('a .board-date')?.textContent).toContain('Oct 5, 2026');
      }
      expect(items[0].querySelector('.board-preview')?.textContent?.trim()).toBe('SR');
      expect(items[1].querySelector('.board-name')?.getAttribute('title')).toBe(
        'Q3 planning with the whole team',
      );
    });

    it('keeps Duplicate and Delete as labelled icon buttons outside the link', () => {
      const item = el().querySelector('.board-item') as HTMLElement;
      const buttons = [...item.querySelectorAll('.board-actions button')];

      expect(buttons.map((b) => b.getAttribute('aria-label'))).toEqual([
        'Duplicate the board Sprint review',
        'Delete the board Sprint review',
      ]);
      expect(buttons.every((b) => !b.closest('a'))).toBe(true);
    });
  });

  it('shows an empty state with a way to create the first board', async () => {
    await respondWith([]);

    expect(text()).toContain('No boards yet');
    expect(el().querySelector('.boards')).toBeNull();
    expect((el().querySelector('.create-first') as HTMLElement).textContent).toContain(
      'Create your first board',
    );
  });

  describe('the New board button in the header', () => {
    const headerButton = () =>
      el().querySelector('.page-header button.new-board') as HTMLButtonElement | null;

    it('is there while the boards load', () => {
      expect(headerButton()?.getAttribute('aria-label')).toBe('New board');
      http.expectOne('/api/boards').flush([]);
      http.expectOne('/api/rooms').flush([]);
    });

    it('is there in the empty state, which keeps a secondary button that does the same', async () => {
      await respondWith([]);
      expect(headerButton()).not.toBeNull();

      await click('.create-first');
      http.expectOne('/api/templates').flush(TEMPLATES);
      await fixture.whenStable();

      expect(el().querySelector('form')).not.toBeNull();
    });

    it('is there with boards and while the form is open, and opens the form', async () => {
      await respondWith([board('b1', 'Retro')]);
      expect(el().querySelector('.page-title .new-board')).toBeNull();

      await click('.page-header button.new-board');
      http.expectOne('/api/templates').flush(TEMPLATES);
      await fixture.whenStable();

      expect(el().querySelector('form')).not.toBeNull();
      expect(headerButton()).not.toBeNull();
    });

    it('is there when the boards could not be loaded', async () => {
      http.expectOne('/api/boards').flush('', { status: 502, statusText: 'Bad Gateway' });
      http.expectOne('/api/rooms').flush([]);
      await fixture.whenStable();

      expect(headerButton()).not.toBeNull();
    });

    it('leaves a form that is already open as it is', async () => {
      await respondWith([board('b1', 'Retro')]);
      await click('.new-board');
      http.expectOne('/api/templates').flush(TEMPLATES);
      await type('Typed name');

      await click('.new-board');

      expect((el().querySelector('input') as HTMLInputElement).value).toBe('Typed name');
    });
  });

  it('shows how many boards there are in the title row', async () => {
    await respondWith([board('b2', 'Sprint review'), board('b1', 'Retro')]);
    expect(el().querySelector('.board-count')?.textContent?.trim()).toBe('2 boards');
  });

  it('says "1 board" for a single board', async () => {
    await respondWith([board('b1', 'Retro')]);
    expect(el().querySelector('.board-count')?.textContent?.trim()).toBe('1 board');
  });

  it('shows an error with a retry when the boards cannot be loaded', async () => {
    http.expectOne('/api/boards').flush('', { status: 502, statusText: 'Bad Gateway' });
    http.expectOne('/api/rooms').flush([]);
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
      http.expectOne('/api/templates').flush(TEMPLATES);
      await fixture.whenStable();
    });

    const radios = () => [...el().querySelectorAll('input[type="radio"]')] as HTMLInputElement[];
    const optionNames = () =>
      [...el().querySelectorAll('.template-option .template-name')].map((n) => n.textContent);

    it('lays the templates out as a radio group of tiles', () => {
      const group = el().querySelector('[role="radiogroup"]') as HTMLElement;

      expect(group.getAttribute('aria-label')).toBe('Start from');
      expect(group.querySelectorAll('label.template-option input[type="radio"]')).toHaveLength(3);
    });

    it('asks for a name in an inline field, preset to "Untitled board" and focused', () => {
      const input = el().querySelector('input') as HTMLInputElement;

      expect(input.value).toBe('Untitled board');
      expect(input.maxLength).toBe(120);
      expect(document.activeElement).toBe(input);
    });

    it('is a modal dialog that closes when the dimmed area around it is clicked', async () => {
      const dialog = el().querySelector('form[role="dialog"]') as HTMLElement;
      expect(dialog.getAttribute('aria-modal')).toBe('true');
      expect(dialog.getAttribute('aria-labelledby')).toBe('create-title');
      expect(dialog.closest('.backdrop')).not.toBeNull();

      dialog.click();
      await fixture.whenStable();
      expect(el().querySelector('form')).not.toBeNull();

      (el().querySelector('.backdrop') as HTMLElement).click();
      await fixture.whenStable();
      expect(el().querySelector('form')).toBeNull();
    });

    it('closes on Escape from a template tile too', async () => {
      (radios()[1] as HTMLElement).dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
      );
      await fixture.whenStable();

      expect(el().querySelector('form')).toBeNull();
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

    it('offers Blank, selected, and the templates from the catalog with their descriptions', () => {
      expect(optionNames()).toEqual(['Blank', 'Retrospective', 'Kanban']);
      expect(radios().map((radio) => radio.checked)).toEqual([true, false, false]);
      expect(text()).toContain('Three columns.');
    });

    it('creates a blank board without a template by default', async () => {
      const navigate = vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);

      await submit();
      http.expectOne('/api/boards').flush(board('b9', 'Untitled board'));
      await fixture.whenStable();

      expect(navigate).toHaveBeenCalledWith('/board/b9');
    });

    it('hands the chosen template to the new board page', async () => {
      const navigate = vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);

      radios()[2].click();
      await fixture.whenStable();
      await submit();
      http.expectOne('/api/boards').flush(board('b9', 'Untitled board'));
      await fixture.whenStable();

      expect(navigate).toHaveBeenCalledWith('/board/b9', { state: { templateId: 't-kanban' } });
    });

    it('starts blank again when the form is reopened', async () => {
      radios()[1].click();
      await fixture.whenStable();
      await click('button[type="button"].button:not(.primary)'); // Cancel
      await click('.new-board');

      expect(radios().map((radio) => radio.checked)).toEqual([true, false, false]);
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
      await click('form button[type="button"]'); // Cancel in the form (not the user menu in the header)
      expect(el().querySelector('form')).toBeNull();

      await click('.new-board');
      (el().querySelector('input') as HTMLInputElement).dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
      );
      await fixture.whenStable();

      expect(el().querySelector('form')).toBeNull();
      http.expectNone('/api/boards');
    });
  });

  describe('a catalog that cannot be loaded', () => {
    it('still offers a blank board', async () => {
      await respondWith([board('b1', 'Retro')]);
      await click('.new-board');
      http.expectOne('/api/templates').flush(null, { status: 502, statusText: 'Bad Gateway' });
      await fixture.whenStable();

      const names = [...el().querySelectorAll('.template-option .template-name')];
      expect(names.map((n) => n.textContent)).toEqual(['Blank']);
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

  describe('duplicating a board', () => {
    beforeEach(async () => {
      await respondWith([board('b2', 'Sprint review'), board('b1', 'Retro')]);
    });

    const duplicateButton = (name: string) =>
      el().querySelector(`button[aria-label="Duplicate the board ${name}"]`) as HTMLButtonElement;

    it('offers a labelled Duplicate next to every board, not inside its link', () => {
      const buttons = [...el().querySelectorAll('.duplicate-button')];

      expect(buttons.map((b) => b.getAttribute('aria-label'))).toEqual([
        'Duplicate the board Sprint review',
        'Duplicate the board Retro',
      ]);
      expect(buttons.every((b) => !b.closest('a'))).toBe(true);
    });

    it('duplicates the chosen board and opens the copy', async () => {
      const navigate = vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);

      duplicateButton('Retro').click();
      await fixture.whenStable();
      const request = http.expectOne('/api/boards/b1/duplicate');
      expect(request.request.method).toBe('POST');
      expect(duplicateButton('Retro').disabled).toBe(true); // no second click while it runs
      expect(duplicateButton('Sprint review').disabled).toBe(true);
      request.flush(board('b9', 'Retro (copy)'));
      await fixture.whenStable();

      expect(navigate).toHaveBeenCalledWith('/board/b9');
    });

    it('says so and stays on the list when duplicating fails, and allows another try', async () => {
      const navigate = vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);

      duplicateButton('Retro').click();
      await fixture.whenStable();
      http
        .expectOne('/api/boards/b1/duplicate')
        .flush('', { status: 502, statusText: 'Bad Gateway' });
      await fixture.whenStable();

      expect(el().querySelector('.duplicate-error')?.textContent).toContain(
        'could not be duplicated',
      );
      expect(el().querySelector('.duplicate-error')?.textContent).toContain('Retro');
      expect(navigate).not.toHaveBeenCalled();
      expect(duplicateButton('Retro').disabled).toBe(false);

      duplicateButton('Retro').click();
      await fixture.whenStable();
      http.expectOne('/api/boards/b1/duplicate').flush(board('b9', 'Retro (copy)'));
      await fixture.whenStable();

      expect(el().querySelector('.duplicate-error')).toBeNull();
      expect(navigate).toHaveBeenCalledWith('/board/b9');
    });
  });

  describe('rooms', () => {
    const SPRINT: RoomInfo = {
      id: 'r1',
      name: 'Sprint',
      createdAt: '2026-10-01T00:00:00Z',
      role: 'Owner',
    };
    const CUSTOMER: RoomInfo = {
      id: 'r2',
      name: 'Customer X',
      createdAt: '2026-10-02T00:00:00Z',
      role: 'Viewer',
    };
    const IN_SPRINT = board('b1', 'Retro', '2026-10-05T10:00:00Z', 'r1');
    const IN_CUSTOMER = board('b2', 'Kickoff', '2026-10-05T10:00:00Z', 'r2');
    const LOOSE = board('b3', 'Loose board', '2026-10-05T10:00:00Z');

    const view = async (roomId: string | undefined) => {
      fixture.componentRef.setInput('roomId', roomId);
      await fixture.whenStable();
    };
    const names = () =>
      [...el().querySelectorAll('.board-name')].map((name) => name.textContent?.trim());
    const entries = () =>
      [...el().querySelectorAll('app-room-sidebar .entry')].map(
        (entry) =>
          `${entry.querySelector('.entry-name')?.textContent?.trim()} ${entry.querySelector('.entry-count')?.textContent?.trim()}`,
      );
    const typeInto = async (selector: string, value: string) => {
      const input = el().querySelector(selector) as HTMLInputElement;
      input.value = value;
      input.dispatchEvent(new Event('input'));
      await fixture.whenStable();
    };
    const submitForm = async (selector: string) => {
      (el().querySelector(selector) as HTMLFormElement).dispatchEvent(new Event('submit'));
      await fixture.whenStable();
    };
    const button = (label: string) =>
      [...el().querySelectorAll('button')].find((b) => b.textContent?.trim() === label) as
        HTMLButtonElement | undefined;
    const clickButton = async (label: string) => {
      button(label)!.click();
      await fixture.whenStable();
    };

    beforeEach(async () => {
      await respondWith([IN_SPRINT, IN_CUSTOMER, LOOSE], [SPRINT, CUSTOMER]);
    });

    describe('the sidebar', () => {
      it('lists all boards, the boards in no room and the rooms, each with its count', () => {
        expect(entries()).toEqual(['All boards 3', 'Not in a room 1', 'Sprint 1', 'Customer X 1']);
        expect(
          [...el().querySelectorAll('app-room-sidebar .entry')].map((a) => a.getAttribute('href')),
        ).toEqual(['/', '/rooms/none', '/rooms/r1', '/rooms/r2']);
      });

      it('marks the open view', async () => {
        await view('r1');

        const current = el().querySelector('app-room-sidebar [aria-current="page"]');
        expect(current?.textContent).toContain('Sprint');
        expect(el().querySelectorAll('app-room-sidebar [aria-current="page"]')).toHaveLength(1);
      });

      it('says there are no rooms yet and still offers New room', async () => {
        fixture.destroy();
        fixture = TestBed.createComponent(BoardList);
        await fixture.whenStable();
        await respondWith([LOOSE], []);

        expect(el().querySelector('app-room-sidebar')?.textContent).toContain('No rooms yet');
        expect(button('+ New room')).toBeDefined();
      });

      it('keeps the boards when the rooms cannot be loaded, and offers to try again', async () => {
        fixture.destroy();
        fixture = TestBed.createComponent(BoardList);
        await fixture.whenStable();
        http.expectOne('/api/boards').flush([LOOSE]);
        http.expectOne('/api/rooms').flush('', { status: 502, statusText: 'Bad Gateway' });
        await fixture.whenStable();

        expect(names()).toEqual(['Loose board']);
        expect(el().querySelector('app-room-sidebar [role="alert"]')?.textContent).toContain(
          'could not be loaded',
        );

        (el().querySelector('app-room-sidebar .link') as HTMLElement).click();
        http.expectOne('/api/rooms').flush([SPRINT]);
        await fixture.whenStable();

        expect(entries()).toContain('Sprint 0');
      });
    });

    describe('the views', () => {
      it('shows every board in the all-boards view, with the room of each as a label', () => {
        expect(names()).toEqual(['Retro', 'Kickoff', 'Loose board']);
        expect([...el().querySelectorAll('.board-room')].map((l) => l.textContent)).toEqual([
          'Sprint',
          'Customer X',
        ]);
      });

      it('shows only the boards of a room, titled with its name and without the label', async () => {
        await view('r1');

        expect(names()).toEqual(['Retro']);
        expect(el().querySelector('h1')?.textContent).toBe('Sprint');
        expect(el().querySelector('.board-room')).toBeNull();
        expect(el().querySelector('.board-count')?.textContent?.trim()).toBe('1 board');
      });

      it('shows only the boards in no room at /rooms/none', async () => {
        await view('none');

        expect(names()).toEqual(['Loose board']);
        expect(el().querySelector('h1')?.textContent).toBe('Not in a room');
      });

      it('goes back to all boards without asking the backend again', async () => {
        await view('r1');
        await view(undefined);

        expect(names()).toEqual(['Retro', 'Kickoff', 'Loose board']);
        http.expectNone('/api/boards');
      });

      it("says so for a room that is not among the user's rooms", async () => {
        await view('nope');

        expect(el().querySelector('.room-missing')?.textContent).toContain('Room not found');
        expect(el().querySelector('.board-item')).toBeNull();
      });

      it('has an empty state for a room without boards, with a way to start one there', async () => {
        const empty: RoomInfo = { ...SPRINT, id: 'r3', name: 'Empty' };
        fixture.destroy();
        fixture = TestBed.createComponent(BoardList);
        await fixture.whenStable();
        await respondWith([LOOSE], [empty]);
        await view('r3');

        expect(el().querySelector('.view-empty')?.textContent).toContain(
          'No boards in this room yet',
        );
        expect(el().querySelector('.create-first')?.textContent).toContain(
          'first board in this room',
        );
      });

      it('has an empty state for the boards in no room when every board is in a room', async () => {
        fixture.destroy();
        fixture = TestBed.createComponent(BoardList);
        await fixture.whenStable();
        await respondWith([IN_SPRINT], [SPRINT]);
        await view('none');

        expect(el().querySelector('.view-empty')?.textContent).toContain(
          'Every board is in a room',
        );
      });
    });

    describe('New room', () => {
      let navigate: ReturnType<typeof vi.spyOn>;

      beforeEach(async () => {
        navigate = vi.spyOn(router, 'navigate').mockResolvedValue(true);
        await clickButton('+ New room');
      });

      it('opens an inline field with the cursor in it', () => {
        expect(document.activeElement).toBe(el().querySelector('#room-name'));
      });

      it('creates the room, lists it by name and opens its view', async () => {
        await typeInto('#room-name', '  Alpha  ');
        await submitForm('app-room-sidebar form');

        const request = http.expectOne('/api/rooms');
        expect(request.request.method).toBe('POST');
        expect(request.request.body).toEqual({ name: 'Alpha' });
        request.flush({
          id: 'r9',
          name: 'Alpha',
          createdAt: '2026-10-07T00:00:00Z',
          role: 'Owner',
        });
        await fixture.whenStable();

        expect(entries().slice(2)).toEqual(['Alpha 0', 'Customer X 1', 'Sprint 1']);
        expect(navigate).toHaveBeenCalledWith(['/rooms', 'r9']);
        expect(el().querySelector('app-room-sidebar form')).toBeNull();
      });

      it('does not create a room without a name', async () => {
        await typeInto('#room-name', '   ');
        await submitForm('app-room-sidebar form');

        http.expectNone('/api/rooms');
        expect(el().querySelector('app-room-sidebar [role="alert"]')?.textContent).toContain(
          'Give the room a name',
        );
      });

      it("shows the backend's message and keeps the form when it refuses", async () => {
        await typeInto('#room-name', 'Alpha');
        await submitForm('app-room-sidebar form');
        http
          .expectOne('/api/rooms')
          .flush({ message: 'The name is taken.' }, { status: 400, statusText: 'Bad Request' });
        await fixture.whenStable();

        expect(el().querySelector('app-room-sidebar [role="alert"]')?.textContent).toContain(
          'The name is taken.',
        );
        expect((el().querySelector('#room-name') as HTMLInputElement).value).toBe('Alpha');
      });

      it('closes on Escape and on Cancel without a request', async () => {
        (el().querySelector('#room-name') as HTMLElement).dispatchEvent(
          new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
        );
        await fixture.whenStable();
        expect(el().querySelector('app-room-sidebar form')).toBeNull();

        await clickButton('+ New room');
        await clickButton('Cancel');
        expect(el().querySelector('app-room-sidebar form')).toBeNull();
        http.expectNone('/api/rooms');
      });
    });

    describe('renaming and deleting a room', () => {
      it('offers rename, members and delete to an owner', async () => {
        await view('r1');

        expect(button('Rename')).toBeDefined();
        expect(button('Members')).toBeDefined();
        expect(button('Delete room')).toBeDefined();
      });

      it('offers only rename to an editor', async () => {
        fixture.destroy();
        fixture = TestBed.createComponent(BoardList);
        await fixture.whenStable();
        await respondWith([IN_SPRINT], [{ ...SPRINT, role: 'Editor' }]);
        await view('r1');

        expect(button('Rename')).toBeDefined();
        expect(button('Members')).toBeUndefined();
        expect(button('Delete room')).toBeUndefined();
      });

      it('renames the room: the field takes the name, Save sends it, the title follows', async () => {
        await view('r1');
        await clickButton('Rename');
        expect(document.activeElement).toBe(el().querySelector('#room-rename'));

        await typeInto('#room-rename', 'Sprint 42');
        await submitForm('form.rename');
        const request = http.expectOne('/api/rooms/r1');
        expect(request.request.method).toBe('PATCH');
        expect(request.request.body).toEqual({ name: 'Sprint 42' });
        request.flush({ ...SPRINT, name: 'Sprint 42' });
        await fixture.whenStable();

        expect(el().querySelector('h1')?.textContent).toBe('Sprint 42');
        expect(entries()).toContain('Sprint 42 1');
      });

      it('sends nothing for an unchanged name and cancels on Escape', async () => {
        await view('r1');
        await clickButton('Rename');
        await submitForm('form.rename');
        http.expectNone('/api/rooms/r1');
        expect(el().querySelector('form.rename')).toBeNull();

        await clickButton('Rename');
        (el().querySelector('#room-rename') as HTMLElement).dispatchEvent(
          new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
        );
        await fixture.whenStable();
        expect(el().querySelector('form.rename')).toBeNull();
      });

      it('says why a rename failed and keeps the field', async () => {
        await view('r1');
        await clickButton('Rename');
        await typeInto('#room-rename', 'Other');
        await submitForm('form.rename');
        http.expectOne('/api/rooms/r1').flush('', { status: 403, statusText: 'Forbidden' });
        await fixture.whenStable();

        expect(el().querySelector('.room-error')?.textContent).toContain('owner of the room');
        expect(el().querySelector('form.rename')).not.toBeNull();
      });

      it('asks before deleting, says that the boards stay, and does nothing on Cancel', async () => {
        await view('r1');
        await clickButton('Delete room');

        const confirm = el().querySelector('[aria-label="Confirm room delete"]') as HTMLElement;
        expect(confirm.textContent).toContain('Delete the room “Sprint”');
        expect(confirm.textContent).toContain('1 board stays');
        http.expectNone('/api/rooms/r1');

        (confirm.querySelector('button:not(.danger)') as HTMLElement).click();
        await fixture.whenStable();
        expect(el().querySelector('[aria-label="Confirm room delete"]')).toBeNull();
      });

      it('deletes the room: the boards stay in no room and the list goes back to all boards', async () => {
        const navigate = vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);
        await view('r1');
        await clickButton('Delete room');

        (el().querySelector('[aria-label="Confirm room delete"] .danger') as HTMLElement).click();
        await fixture.whenStable();
        const request = http.expectOne('/api/rooms/r1');
        expect(request.request.method).toBe('DELETE');
        request.flush(null, { status: 204, statusText: 'No Content' });
        await fixture.whenStable();

        expect(navigate).toHaveBeenCalledWith('/');
        expect(entries()).toEqual(['All boards 3', 'Not in a room 2', 'Customer X 1']);
      });

      it('keeps the room and says so when deleting fails', async () => {
        await view('r1');
        await clickButton('Delete room');
        (el().querySelector('[aria-label="Confirm room delete"] .danger') as HTMLElement).click();
        await fixture.whenStable();
        http.expectOne('/api/rooms/r1').flush('', { status: 403, statusText: 'Forbidden' });
        await fixture.whenStable();

        expect(el().querySelector('[aria-label="Confirm room delete"]')?.textContent).toContain(
          'owner of the room',
        );
        expect(entries()).toContain('Sprint 1');
      });
    });

    describe('the members of a room', () => {
      it('opens the share dialog for the room', async () => {
        await view('r1');
        await clickButton('Members');

        http.expectOne('/api/rooms/r1/members').flush([]);
        await fixture.whenStable();
        expect(el().querySelector('app-share-dialog h2')?.textContent).toContain('Share this room');
      });
    });

    describe('a viewer of a room', () => {
      beforeEach(async () => {
        await view('r2');
      });

      it('sees the boards but no write action', () => {
        expect(names()).toEqual(['Kickoff']);
        expect(el().querySelector('.page-header .new-board')).toBeNull();
        expect(button('Rename')).toBeUndefined();
        expect(button('Members')).toBeUndefined();
        expect(button('Delete room')).toBeUndefined();
      });

      it('has no way to put boards in the room', async () => {
        await view(undefined);
        (
          el().querySelector(
            'button[aria-label="Move the board Loose board to a room"]',
          ) as HTMLElement
        ).click();
        await fixture.whenStable();

        const items = [...el().querySelectorAll('.move-item')].map((i) => i.textContent?.trim());
        expect(items).toEqual(['Move to Sprint']);
      });

      it('has no create-first button in an empty room', async () => {
        fixture.destroy();
        fixture = TestBed.createComponent(BoardList);
        await fixture.whenStable();
        await respondWith([LOOSE], [CUSTOMER]);
        await view('r2');

        expect(el().querySelector('.view-empty')).not.toBeNull();
        expect(el().querySelector('.create-first')).toBeNull();
      });
    });

    describe('moving a board with the menu', () => {
      const openMenu = async (name: string) => {
        (
          el().querySelector(`button[aria-label="Move the board ${name} to a room"]`) as HTMLElement
        ).click();
        await fixture.whenStable();
      };
      const items = () =>
        [...el().querySelectorAll('.move-item')].map((i) => i.textContent?.trim());

      it('offers the rooms the user may write in, and "Remove from room" for a board that is in one', async () => {
        await openMenu('Retro');
        expect(items()).toEqual(['Remove from room']); // Sprint is its room, Customer X is read-only
        expect(el().querySelector('.move-button')?.getAttribute('aria-expanded')).toBe('true');

        await openMenu('Retro');
        await openMenu('Loose board');
        expect(items()).toEqual(['Move to Sprint']);
      });

      it('puts the board in the room and updates the counts', async () => {
        await openMenu('Loose board');
        (el().querySelector('.move-item') as HTMLElement).click();
        await fixture.whenStable();

        const request = http.expectOne('/api/boards/b3/room');
        expect(request.request.method).toBe('PUT');
        expect(request.request.body).toEqual({ roomId: 'r1' });
        request.flush({ ...LOOSE, roomId: 'r1' });
        await fixture.whenStable();

        expect(entries()).toEqual(['All boards 3', 'Not in a room 0', 'Sprint 2', 'Customer X 1']);
        expect(el().querySelector('.move-menu')).toBeNull();
      });

      it('takes the board out of its room', async () => {
        await openMenu('Retro');
        (el().querySelector('.move-item') as HTMLElement).click();
        await fixture.whenStable();

        const request = http.expectOne('/api/boards/b1/room');
        expect(request.request.body).toEqual({ roomId: null });
        request.flush({ ...IN_SPRINT, roomId: null });
        await fixture.whenStable();

        expect(entries()).toContain('Not in a room 2');
      });

      it('moves the board out of the open room view when it leaves the room', async () => {
        await view('r1');
        await openMenu('Retro');
        (el().querySelector('.move-item') as HTMLElement).click();
        http.expectOne('/api/boards/b1/room').flush({ ...IN_SPRINT, roomId: null });
        await fixture.whenStable();

        expect(el().querySelector('.board-item')).toBeNull();
        expect(el().querySelector('.view-empty')).not.toBeNull();
      });

      it('says why a move failed and leaves the board where it is', async () => {
        await openMenu('Loose board');
        (el().querySelector('.move-item') as HTMLElement).click();
        http.expectOne('/api/boards/b3/room').flush('', { status: 403, statusText: 'Forbidden' });
        await fixture.whenStable();

        expect(el().querySelector('.room-error')?.textContent).toContain(
          '“Loose board” could not be moved',
        );
        expect(entries()).toContain('Not in a room 1');
      });

      it('closes on Escape and on a click elsewhere', async () => {
        await openMenu('Loose board');
        (el().querySelector('.move-menu') as HTMLElement).dispatchEvent(
          new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
        );
        await fixture.whenStable();
        expect(el().querySelector('.move-menu')).toBeNull();

        await openMenu('Loose board');
        document.body.click();
        await fixture.whenStable();
        expect(el().querySelector('.move-menu')).toBeNull();
      });
    });

    describe('moving a board by dragging it to the sidebar', () => {
      const drag = (kind: string, target: Element) => {
        const event = new Event(kind, { bubbles: true, cancelable: true });
        Object.defineProperty(event, 'dataTransfer', {
          value: { setData: () => undefined, effectAllowed: '' },
        });
        target.dispatchEvent(event);
        return event;
      };
      const card = (name: string) =>
        [...el().querySelectorAll('.board-item')].find((item) =>
          item.textContent?.includes(name),
        ) as HTMLElement;
      const entry = (name: string) =>
        [...el().querySelectorAll('app-room-sidebar .entry')].find((item) =>
          item.textContent?.includes(name),
        ) as HTMLElement;

      it('puts a dragged board in the room it is dropped on', async () => {
        drag('dragstart', card('Loose board'));
        await fixture.whenStable();
        expect(entry('Sprint').classList).toContain('can-drop');
        expect(entry('Customer X').classList).not.toContain('can-drop'); // read-only

        const over = drag('dragover', entry('Sprint'));
        expect(over.defaultPrevented).toBe(true);
        await fixture.whenStable();
        expect(entry('Sprint').classList).toContain('drop-target');

        drag('drop', entry('Sprint'));
        const request = http.expectOne('/api/boards/b3/room');
        expect(request.request.body).toEqual({ roomId: 'r1' });
        request.flush({ ...LOOSE, roomId: 'r1' });
        await fixture.whenStable();

        expect(entries()).toContain('Sprint 2');
      });

      it('takes a board out of its room when it is dropped on "Not in a room"', async () => {
        drag('dragstart', card('Retro'));
        await fixture.whenStable();
        drag('drop', entry('Not in a room'));

        const request = http.expectOne('/api/boards/b1/room');
        expect(request.request.body).toEqual({ roomId: null });
        request.flush({ ...IN_SPRINT, roomId: null });
        await fixture.whenStable();
      });

      it('does not accept a drop on a read-only room, or when nothing is dragged', async () => {
        const idle = drag('dragover', entry('Sprint'));
        expect(idle.defaultPrevented).toBe(false);

        drag('dragstart', card('Loose board'));
        await fixture.whenStable();
        const readOnly = drag('dragover', entry('Customer X'));
        expect(readOnly.defaultPrevented).toBe(false);
        drag('drop', entry('Customer X'));
        http.expectNone('/api/boards/b3/room');

        drag('dragend', card('Loose board'));
        await fixture.whenStable();
        expect(entry('Sprint').classList).not.toContain('can-drop');
      });

      it('does not start a drag for a board that has nowhere to go', async () => {
        fixture.destroy();
        fixture = TestBed.createComponent(BoardList);
        await fixture.whenStable();
        await respondWith([LOOSE], []); // no rooms: nothing to drop on
        const event = drag('dragstart', card('Loose board'));

        expect(event.defaultPrevented).toBe(true);
        expect(card('Loose board').getAttribute('draggable')).toBeNull();
      });
    });

    describe('New board in a room view', () => {
      let navigate: ReturnType<typeof vi.spyOn>;

      beforeEach(async () => {
        navigate = vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);
        await view('r1');
        await click('.page-header .new-board');
        http.expectOne('/api/templates').flush(TEMPLATES);
        await fixture.whenStable();
      });

      it('says which room the board is for', () => {
        expect(el().querySelector('.create-room')?.textContent).toContain('In the room “Sprint”');
      });

      it('creates the board, puts it in the room and then opens it', async () => {
        await submit();
        http.expectOne('/api/boards').flush(board('b9', 'Untitled board'));
        await fixture.whenStable();

        const move = http.expectOne('/api/boards/b9/room');
        expect(move.request.method).toBe('PUT');
        expect(move.request.body).toEqual({ roomId: 'r1' });
        expect(navigate).not.toHaveBeenCalled();
        move.flush(board('b9', 'Untitled board', '2026-10-05T10:00:00Z', 'r1'));
        await fixture.whenStable();

        expect(navigate).toHaveBeenCalledWith('/board/b9');
      });

      it('hands the template on as before', async () => {
        (el().querySelectorAll('input[type="radio"]')[2] as HTMLInputElement).click();
        await fixture.whenStable();
        await submit();
        http.expectOne('/api/boards').flush(board('b9', 'Untitled board'));
        await fixture.whenStable();
        http.expectOne('/api/boards/b9/room').flush(board('b9', 'Untitled board', 'x', 'r1'));
        await fixture.whenStable();

        expect(navigate).toHaveBeenCalledWith('/board/b9', { state: { templateId: 't-kanban' } });
      });

      it('says so, stays on the list and reloads it when the board could not be put in the room', async () => {
        await submit();
        http.expectOne('/api/boards').flush(board('b9', 'Untitled board'));
        await fixture.whenStable();
        http.expectOne('/api/boards/b9/room').flush('', { status: 403, statusText: 'Forbidden' });
        await fixture.whenStable();

        expect(navigate).not.toHaveBeenCalled();
        expect(el().querySelector('.room-error')?.textContent).toContain(
          'created, but could not be put in the room “Sprint”',
        );
        expect(el().querySelector('form')).toBeNull();
        http.expectOne('/api/boards').flush([IN_SPRINT, board('b9', 'Untitled board'), LOOSE]);
        http.expectOne('/api/rooms').flush([SPRINT, CUSTOMER]);
      });
    });

    it('creates a board outside any room from the all-boards and the no-room views', async () => {
      const navigate = vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);
      await view('none');
      await click('.page-header .new-board');
      http.expectOne('/api/templates').flush(TEMPLATES);
      await fixture.whenStable();
      expect(el().querySelector('.create-room')).toBeNull();

      await submit();
      http.expectOne('/api/boards').flush(board('b9', 'Untitled board'));
      await fixture.whenStable();

      http.expectNone('/api/boards/b9/room');
      expect(navigate).toHaveBeenCalledWith('/board/b9');
    });
  });

  describe('login', () => {
    it('shows the signed-in user in the header, with Log out', async () => {
      await respondWith([]);
      expect(el().querySelector('.page-header app-user-menu')?.textContent).toContain(
        FAKE_USER.name,
      );

      (el().querySelector('.page-header .user-button') as HTMLButtonElement).click();
      await fixture.whenStable();
      (el().querySelector('.page-header [role="menuitem"]') as HTMLButtonElement).click();

      expect((TestBed.inject(SessionService) as unknown as FakeSession).logoutCalls).toBe(1);
    });
  });
});
