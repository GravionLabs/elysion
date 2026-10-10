import { Location } from '@angular/common';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, DeferBlockState, TestBed } from '@angular/core/testing';
import { By, Title } from '@angular/platform-browser';
import { provideRouter } from '@angular/router';
import { TopBar } from '../topbar/top-bar';
import { ShareDialog } from '../share/share-dialog';
import { FAKE_USER, FakeSession, provideFakeSession } from '../auth/testing';
import { SessionService } from '../auth/session.service';
import { ThemeService } from '../theme/theme.service';
import { Board } from './board';
import { CanvasElementLoader } from './canvas-element-loader';

describe('Board', () => {
  let component: Board;
  let fixture: ComponentFixture<Board>;
  let loader: { load: ReturnType<typeof vi.fn> };
  let http: HttpTestingController;

  beforeEach(async () => {
    localStorage.clear();
    loader = { load: vi.fn().mockResolvedValue(undefined) };

    await TestBed.configureTestingModule({
      imports: [Board],
      providers: [
        { provide: CanvasElementLoader, useValue: loader },
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        provideFakeSession(),
      ],
    }).compileComponents();

    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(Board);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('loads the canvas element script once', () => {
    expect(loader.load).toHaveBeenCalledOnce();
    expect(loader.load).toHaveBeenCalledWith(expect.stringContaining('elysion-canvas'));
  });

  it('renders an elysion-canvas element with the board id attribute', () => {
    fixture.componentRef.setInput('boardId', 'board-42');
    fixture.detectChanges();

    const el = fixture.nativeElement.querySelector('elysion-canvas');
    expect(el).toBeTruthy();
    expect(el.getAttribute('board-id')).toBe('board-42');
  });

  it('renders an elysion-canvas element with the yjs server url attribute when set', () => {
    fixture.componentRef.setInput('yjsServerUrl', 'ws://localhost:3000/yjs');
    fixture.detectChanges();

    const el = fixture.nativeElement.querySelector('elysion-canvas');
    expect(el.getAttribute('yjs-server-url')).toBe('ws://localhost:3000/yjs');
  });

  it('passes the app theme to the canvas element and follows a change', () => {
    const canvas = () => fixture.nativeElement.querySelector('elysion-canvas');
    const theme = TestBed.inject(ThemeService);

    theme.set('light');
    fixture.detectChanges();
    expect(canvas().getAttribute('theme')).toBe('light');

    theme.set('dark');
    fixture.detectChanges();
    expect(canvas().getAttribute('theme')).toBe('dark');
  });

  it('switches the app theme from the top bar', () => {
    const theme = TestBed.inject(ThemeService);
    theme.set('light');
    fixture.detectChanges();

    fixture.nativeElement.querySelector('.theme-toggle').click();
    fixture.detectChanges();

    expect(theme.theme()).toBe('dark');
    expect(fixture.nativeElement.querySelector('elysion-canvas').getAttribute('theme')).toBe(
      'dark',
    );
  });

  it('adopts a theme the user switched inside the canvas as the explicit choice', () => {
    const theme = TestBed.inject(ThemeService);
    theme.set('light');

    const el: HTMLElement = fixture.nativeElement.querySelector('elysion-canvas');
    el.dispatchEvent(new CustomEvent('themechange', { detail: { theme: 'dark' } }));
    fixture.detectChanges();

    expect(theme.theme()).toBe('dark');
    expect(localStorage.getItem('elysion.theme')).toBe('dark');
  });

  it('shows the sync status the canvas reports', () => {
    const el: HTMLElement = fixture.nativeElement.querySelector('elysion-canvas');
    const chip = () => fixture.nativeElement.querySelector('[role="status"]').textContent;

    expect(chip()).toContain('Connecting');

    el.dispatchEvent(new CustomEvent('status', { detail: { status: 'connected' } }));
    fixture.detectChanges();
    expect(chip()).toContain('Connected');

    el.dispatchEvent(new CustomEvent('status', { detail: { status: 'disconnected' } }));
    fixture.detectChanges();
    expect(chip()).toContain('Offline');
  });

  describe('library', () => {
    const canvas = () => fixture.nativeElement.querySelector('elysion-canvas') as HTMLElement;
    const button = () =>
      fixture.nativeElement.querySelector('.library-toggle') as HTMLButtonElement;

    it('asks the element to toggle the library when the button is clicked', () => {
      const toggleLibrary = vi.fn();
      Object.assign(canvas(), { toggleLibrary });

      button().click();

      expect(toggleLibrary).toHaveBeenCalledTimes(1);
    });

    it('does nothing, without an error, while the element has no toggleLibrary yet', () => {
      expect(() => button().click()).not.toThrow();
    });

    it('shows the library state the element reports', () => {
      expect(button().getAttribute('aria-pressed')).toBe('false');

      canvas().dispatchEvent(new CustomEvent('librarychange', { detail: { open: true } }));
      fixture.detectChanges();
      expect(button().getAttribute('aria-pressed')).toBe('true');

      canvas().dispatchEvent(new CustomEvent('librarychange', { detail: { open: false } }));
      fixture.detectChanges();
      expect(button().getAttribute('aria-pressed')).toBe('false');
    });
  });

  describe('export and import', () => {
    const canvas = () => fixture.nativeElement.querySelector('elysion-canvas') as HTMLElement;
    const banner = () => fixture.nativeElement.querySelector('.board-banner') as HTMLElement | null;
    const downloads: { download: string }[] = [];

    beforeEach(() => {
      downloads.length = 0;
      vi.stubGlobal(
        'URL',
        Object.assign(URL, { createObjectURL: () => 'blob:x', revokeObjectURL: () => {} }),
      );
      vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
        this: HTMLAnchorElement,
      ) {
        downloads.push({ download: this.download });
      });
    });

    afterEach(() => vi.restoreAllMocks());

    const settle = async () => {
      await fixture.whenStable();
      fixture.detectChanges();
    };

    it('downloads what the canvas exports, named after the board', async () => {
      const exportBoard = vi.fn().mockResolvedValue(new Blob(['x']));
      Object.assign(canvas(), { exportBoard });
      fixture.componentRef.setInput('boardId', 'team-retro');

      await component.exportBoard({ format: 'svg', selectionOnly: false });

      expect(exportBoard).toHaveBeenCalledWith('svg', { selectionOnly: false });
      expect(downloads).toEqual([{ download: 'team-retro.svg' }]);
    });

    it('passes the selection-only choice on and marks the file', async () => {
      const exportBoard = vi.fn().mockResolvedValue(new Blob(['x']));
      Object.assign(canvas(), { exportBoard });
      fixture.componentRef.setInput('boardId', 'team-retro');

      await component.exportBoard({ format: 'png', selectionOnly: true });

      expect(exportBoard).toHaveBeenCalledWith('png', { selectionOnly: true });
      expect(downloads[0].download).toBe('team-retro-selection.png');
    });

    it('downloads a PDF named after the board, for the selection too', async () => {
      const exportBoard = vi
        .fn()
        .mockResolvedValue(new Blob(['%PDF'], { type: 'application/pdf' }));
      Object.assign(canvas(), { exportBoard });
      fixture.componentRef.setInput('boardId', 'team-retro');

      await component.exportBoard({ format: 'pdf', selectionOnly: false });
      await component.exportBoard({ format: 'pdf', selectionOnly: true });

      expect(exportBoard.mock.calls).toEqual([
        ['pdf', { selectionOnly: false }],
        ['pdf', { selectionOnly: true }],
      ]);
      expect(downloads.map((d) => d.download)).toEqual([
        'team-retro.pdf',
        'team-retro-selection.pdf',
      ]);
    });

    it('shows "Preparing PDF…" while the PDF is made and is ready for another export after', async () => {
      let finish!: (blob: Blob) => void;
      Object.assign(canvas(), {
        exportBoard: vi.fn().mockReturnValue(new Promise<Blob>((resolve) => (finish = resolve))),
      });
      const button = () =>
        fixture.nativeElement.querySelector('app-export-menu button') as HTMLButtonElement;

      const done = component.exportBoard({ format: 'pdf', selectionOnly: false });
      await settle();
      expect(button().textContent).toContain('Preparing PDF…');
      expect(downloads).toEqual([]);

      finish(new Blob(['%PDF']));
      await done;
      await settle();

      expect(button().textContent).toContain('Export');
      expect(downloads).toHaveLength(1);
    });

    it('says the export failed and stops showing "Preparing" when the PDF cannot be made', async () => {
      Object.assign(canvas(), { exportBoard: vi.fn().mockRejectedValue(new Error('boom')) });

      await component.exportBoard({ format: 'pdf', selectionOnly: false });
      await settle();

      expect(banner()?.textContent).toContain('export failed');
      expect(
        (fixture.nativeElement.querySelector('app-export-menu button') as HTMLElement).textContent,
      ).not.toContain('Preparing');
    });

    it('says so instead of downloading when there is nothing to export', async () => {
      Object.assign(canvas(), { exportBoard: vi.fn().mockResolvedValue(null) });

      await component.exportBoard({ format: 'png', selectionOnly: false });
      await settle();

      expect(downloads).toEqual([]);
      expect(banner()?.textContent).toContain('nothing to export');
    });

    it('says when nothing is selected for a selection export', async () => {
      Object.assign(canvas(), { exportBoard: vi.fn().mockResolvedValue(null) });

      await component.exportBoard({ format: 'png', selectionOnly: true });
      await settle();

      expect(banner()?.textContent).toContain('Nothing is selected');
    });

    it('reports a failing export and one before the canvas is ready', async () => {
      await component.exportBoard({ format: 'png', selectionOnly: false });
      await settle();
      expect(banner()?.textContent).toContain('not ready');

      Object.assign(canvas(), { exportBoard: vi.fn().mockRejectedValue(new Error('boom')) });
      await component.exportBoard({ format: 'png', selectionOnly: false });
      await settle();
      expect(banner()?.textContent).toContain('export failed');
    });

    it('tells the Export menu whether something is selected', async () => {
      const menuButton = () =>
        fixture.nativeElement.querySelector('app-export-menu button') as HTMLButtonElement;
      menuButton().click();
      await settle();
      const checkbox = () =>
        fixture.nativeElement.querySelector('input[type="checkbox"]') as HTMLInputElement;
      expect(checkbox().disabled).toBe(true);

      canvas().dispatchEvent(new CustomEvent('selectioncount', { detail: { count: 3 } }));
      await settle();

      expect(checkbox().disabled).toBe(false);
    });

    describe('import', () => {
      const file = new File(['{}'], 'plan.excalidraw');

      it('asks before it replaces anything, and does nothing on cancel', async () => {
        const importFile = vi.fn();
        Object.assign(canvas(), { importFile });

        component.chooseImport(file);
        await settle();
        expect(banner()?.textContent).toContain(
          'Replace everything on this board with “plan.excalidraw”',
        );
        expect(importFile).not.toHaveBeenCalled();

        (banner()!.querySelectorAll('button')[1] as HTMLButtonElement).click(); // Cancel
        await settle();

        expect(importFile).not.toHaveBeenCalled();
        expect(banner()).toBeNull();
      });

      it('imports after the confirmation and reports how many elements came in', async () => {
        const importFile = vi.fn().mockResolvedValue(3);
        Object.assign(canvas(), { importFile });
        component.chooseImport(file);
        await settle();

        (banner()!.querySelectorAll('button')[0] as HTMLButtonElement).click(); // Replace
        await settle();

        expect(importFile).toHaveBeenCalledWith(file);
        expect(banner()?.textContent).toContain('Imported 3 elements from plan.excalidraw.');
      });

      it('uses the singular for one element', async () => {
        Object.assign(canvas(), { importFile: vi.fn().mockResolvedValue(1) });
        component.chooseImport(file);
        await component.confirmImport();
        await settle();

        expect(banner()?.textContent).toContain('Imported 1 element from');
      });

      it('shows the reason when the file cannot be imported', async () => {
        Object.assign(canvas(), {
          importFile: vi.fn().mockRejectedValue(new Error('This is not an Excalidraw file.')),
        });
        component.chooseImport(file);

        await component.confirmImport();
        await settle();

        expect(banner()?.textContent).toContain('This is not an Excalidraw file.');
      });

      it('can be dismissed', async () => {
        Object.assign(canvas(), { importFile: vi.fn().mockResolvedValue(2) });
        component.chooseImport(file);
        await component.confirmImport();
        await settle();

        (banner()!.querySelector('button') as HTMLButtonElement).click();
        await settle();

        expect(banner()).toBeNull();
      });
    });
  });

  describe('board name', () => {
    const id = '0197a8d2-1c3e-7a10-8000-000000000001';
    const title = () => fixture.nativeElement.querySelector('.board-title').textContent;

    it('shows the name of a stored board', async () => {
      fixture.componentRef.setInput('boardId', id);
      fixture.detectChanges();
      await fixture.whenStable();
      expect(title()).toContain(id);

      http
        .expectOne(`/api/boards/${id}`)
        .flush({ id, name: 'Q3 planning', createdAt: '', path: '' });
      await fixture.whenStable();
      fixture.detectChanges();

      expect(title()).toContain('Q3 planning');
    });

    it('keeps showing the id, and the canvas, when the BFF fails', async () => {
      fixture.componentRef.setInput('boardId', id);
      fixture.detectChanges();
      await fixture.whenStable();

      http.expectOne(`/api/boards/${id}`).flush('', { status: 502, statusText: 'Bad Gateway' });
      http.expectOne(`/api/boards/${id}/membership/me`).flush({ boardId: id, role: 'editor' });
      await fixture.whenStable();
      fixture.detectChanges();

      expect(title()).toContain(id);
      expect(fixture.nativeElement.querySelector('elysion-canvas')).not.toBeNull();
    });

    it('does not ask the BFF about a room such as default', async () => {
      fixture.componentRef.setInput('boardId', 'default');
      fixture.detectChanges();
      await fixture.whenStable();

      http.expectNone(() => true);
      expect(title()).toContain('default');
    });

    describe('a board that does not exist', () => {
      const open = async () => {
        fixture.componentRef.setInput('boardId', id);
        fixture.detectChanges();
        await fixture.whenStable();
        fixture.detectChanges();
      };
      const answer = async (status: number, body: object | string = '') => {
        http.expectOne(`/api/boards/${id}`).flush(body, { status, statusText: 'x' });
        await fixture.whenStable();
        fixture.detectChanges();
      };

      it('does not start the canvas for a stored board id until the BFF has answered', async () => {
        await open();

        expect(fixture.nativeElement.querySelector('elysion-canvas')).toBeNull();

        await answer(200, { id, name: 'Q3 planning', createdAt: '', path: '' });
        expect(fixture.nativeElement.querySelector('elysion-canvas')).toBeNull(); // the role is still to come

        http.expectOne(`/api/boards/${id}/membership/me`).flush({ boardId: id, role: 'editor' });
        await fixture.whenStable();
        fixture.detectChanges();

        expect(fixture.nativeElement.querySelector('elysion-canvas')).not.toBeNull();
      });

      it('shows "Board not found" with a way back, and no canvas, on a 404', async () => {
        await open();
        await answer(404);

        const page = fixture.nativeElement as HTMLElement;
        expect(page.querySelector('h1')?.textContent).toContain('Board not found');
        expect(page.textContent).toContain('does not exist, or it was deleted');
        expect(page.querySelector('a.not-found-link')?.getAttribute('href')).toBe('/');
        expect(page.querySelector('elysion-canvas')).toBeNull();
        expect(page.querySelector('app-top-bar')).toBeNull();
        expect(TestBed.inject(Title).getTitle()).toBe('Board not found · Elysion');
      });

      it('starts the canvas at once for a room that is not a stored board', async () => {
        fixture.componentRef.setInput('boardId', 'team-retro');
        fixture.detectChanges();
        await fixture.whenStable();
        fixture.detectChanges();

        expect(fixture.nativeElement.querySelector('elysion-canvas')).not.toBeNull();
        expect(fixture.nativeElement.querySelector('h1')?.textContent).not.toContain('not found');
      });
    });

    describe('renaming', () => {
      const flushName = async (name: string) => {
        http.expectOne(`/api/boards/${id}`).flush({ id, name, createdAt: '', path: '' });
        await fixture.whenStable();
        fixture.detectChanges();
      };
      const rename = async (name: string) => {
        const bar = fixture.debugElement.query(By.directive(TopBar)).componentInstance as TopBar;
        bar.renameRequested.emit(name);
        await fixture.whenStable();
        fixture.detectChanges();
      };

      beforeEach(async () => {
        fixture.componentRef.setInput('boardId', id);
        fixture.detectChanges();
        await fixture.whenStable();
        await flushName('Q3 planning');
      });

      it('shows the new name at once and keeps it after the server confirms', async () => {
        await rename('Q4 planning');

        expect(title()).toContain('Q4 planning'); // before the PATCH is answered
        const request = http.expectOne(`/api/boards/${id}`);
        expect(request.request.method).toBe('PATCH');
        expect(request.request.body).toEqual({ name: 'Q4 planning' });
        request.flush({ id, name: 'Q4 planning', createdAt: '', path: '' });
        await fixture.whenStable();
        fixture.detectChanges();

        expect(title()).toContain('Q4 planning');
        expect(fixture.nativeElement.querySelector('.board-banner')).toBeNull();
      });

      it('shows the name the server stored, which is trimmed', async () => {
        await rename('Q4 planning');

        http
          .expectOne(`/api/boards/${id}`)
          .flush({ id, name: 'Q4 planning (stored)', createdAt: '', path: '' });
        await fixture.whenStable();
        fixture.detectChanges();

        expect(title()).toContain('Q4 planning (stored)');
      });

      it('puts the old name back and says so when saving fails', async () => {
        await rename('Q4 planning');

        http.expectOne(`/api/boards/${id}`).flush('', { status: 502, statusText: 'Bad Gateway' });
        await fixture.whenStable();
        fixture.detectChanges();

        expect(title()).toContain('Q3 planning');
        expect(fixture.nativeElement.querySelector('.board-banner')?.textContent).toContain(
          'could not be renamed',
        );
      });

      it('goes back to the name before, not to the loaded one, when a second rename fails', async () => {
        await rename('Q4 planning');
        http
          .expectOne(`/api/boards/${id}`)
          .flush({ id, name: 'Q4 planning', createdAt: '', path: '' });
        await rename('Q5 planning');

        http.expectOne(`/api/boards/${id}`).flush('', { status: 400, statusText: 'Bad Request' });
        await fixture.whenStable();
        fixture.detectChanges();

        expect(title()).toContain('Q4 planning');
      });

      it('names the browser tab after the board', async () => {
        expect(TestBed.inject(Title).getTitle()).toBe('Q3 planning · Elysion');

        await rename('Q4 planning');
        http
          .expectOne(`/api/boards/${id}`)
          .flush({ id, name: 'Q4 planning', createdAt: '', path: '' });
        await fixture.whenStable();

        expect(TestBed.inject(Title).getTitle()).toBe('Q4 planning · Elysion');
      });

      it('offers the rename only for a stored board', async () => {
        expect(fixture.nativeElement.querySelector('.title-button')).not.toBeNull();

        fixture.componentRef.setInput('boardId', 'default');
        fixture.detectChanges();
        await fixture.whenStable();
        fixture.detectChanges();

        expect(fixture.nativeElement.querySelector('.title-button')).toBeNull();
        expect(TestBed.inject(Title).getTitle()).toBe('Elysion');
      });
    });
  });

  it('omits the yjs server url attribute when not set', () => {
    const el = fixture.nativeElement.querySelector('elysion-canvas');
    expect(el.hasAttribute('yjs-server-url')).toBe(false);
  });

  it('moves to ready status when the element dispatches ready', () => {
    expect(component.status()).toBe('loading');

    const el: HTMLElement = fixture.nativeElement.querySelector('elysion-canvas');
    el.dispatchEvent(new CustomEvent('ready'));

    expect(component.status()).toBe('ready');
  });

  it('moves to error status when the element dispatches error', () => {
    const el: HTMLElement = fixture.nativeElement.querySelector('elysion-canvas');
    el.dispatchEvent(new CustomEvent('error'));

    expect(component.status()).toBe('error');
  });

  it('moves to error status when the canvas script fails to load', async () => {
    loader.load = vi.fn().mockRejectedValue(new Error('network error'));
    const failingFixture = TestBed.createComponent(Board);
    const failingComponent = failingFixture.componentInstance;
    await failingFixture.whenStable();

    expect(failingComponent.status()).toBe('error');
  });
  describe('presence', () => {
    const canvas = () => fixture.nativeElement.querySelector('elysion-canvas') as HTMLElement;
    const avatars = () => [...fixture.nativeElement.querySelectorAll('app-top-bar .avatar')];
    const present = (users: unknown) =>
      canvas().dispatchEvent(new CustomEvent('presence', { detail: { users } }));

    it('shows the people of a presence event in the top bar, and no one once they have left', async () => {
      fixture.detectChanges();
      expect(avatars()).toHaveLength(0);

      present([{ id: 'a', name: 'Ada Lovelace', color: '#14b8a6' }]);
      await fixture.whenStable();
      expect(avatars().map((avatar) => avatar.textContent.trim())).toEqual(['AL']);

      present([]);
      await fixture.whenStable();
      expect(avatars()).toHaveLength(0);
    });

    it('ignores entries that are not users', async () => {
      fixture.detectChanges();

      present([{ id: 'a', name: 'Ada', color: 'red' }, 'x']);
      await fixture.whenStable();

      expect(avatars()).toHaveLength(0);
    });
  });

  describe('connection failures', () => {
    const canvas = () => fixture.nativeElement.querySelector('elysion-canvas') as HTMLElement;

    it('goes back to ready once the connection is up again', () => {
      fixture.detectChanges();
      canvas().dispatchEvent(new CustomEvent('ready'));
      canvas().dispatchEvent(new CustomEvent('error', { detail: { message: 'down' } }));
      expect(component.status()).toBe('error');

      canvas().dispatchEvent(new CustomEvent('status', { detail: { status: 'connected' } }));

      expect(component.status()).toBe('ready');
    });
  });

  describe('login', () => {
    const canvas = () => fixture.nativeElement.querySelector('elysion-canvas') as HTMLElement;
    const session = () => TestBed.inject(SessionService) as unknown as FakeSession;

    it("passes the signed-in user's name and color to the canvas for presence", () => {
      fixture.detectChanges();

      expect(canvas().getAttribute('user-name')).toBe(FAKE_USER.name);
      expect(canvas().getAttribute('user-color')).toBe(FAKE_USER.color);
    });

    it('sets no name or color for the canvas without a user (it keeps its generated guest identity)', () => {
      session().user.set(null);
      fixture.detectChanges();

      expect(canvas().hasAttribute('user-name')).toBe(false);
      expect(canvas().hasAttribute('user-color')).toBe(false);
    });

    it('shows the user in the top bar and logs out from there', () => {
      fixture.detectChanges();
      const menu = fixture.nativeElement.querySelector('app-top-bar app-user-menu');
      expect(menu.textContent).toContain(FAKE_USER.name);

      fixture.debugElement.query(By.directive(TopBar)).componentInstance.logoutRequested.emit();

      expect(session().logoutCalls).toBe(1);
    });
  });

  describe('images (#702)', () => {
    const canvas = () =>
      fixture.nativeElement.querySelector('elysion-canvas') as HTMLElement & {
        fileStore?: { put(file: Blob, id: string): Promise<void>; get(id: string): Promise<Blob> };
      };
    const STORED = '0197a8d2-1c3e-7a10-8000-000000000001';
    /** Opens a stored board: its canvas starts once the board and the caller's role are known. */
    const openStored = async () => {
      fixture.componentRef.setInput('boardId', STORED);
      fixture.detectChanges();
      await fixture.whenStable();
      http
        .expectOne(`/api/boards/${STORED}`)
        .flush({ id: STORED, name: 'Retro', createdAt: '', path: '' });
      await fixture.whenStable();
      http
        .expectOne(`/api/boards/${STORED}/membership/me`)
        .flush({ boardId: STORED, role: 'editor' });
      await fixture.whenStable();
      fixture.detectChanges();
    };

    it('gives a stored board the images tool and the file store, backed by the BFF', async () => {
      await openStored();

      expect(canvas().hasAttribute('images-enabled')).toBe(true);
      const loaded = canvas().fileStore!.get('abcdef0123456789abcdef0123456789abcdef01');
      http
        .expectOne(`/api/boards/${STORED}/files/abcdef0123456789abcdef0123456789abcdef01`)
        .flush(new Blob(['x'], { type: 'image/png' }));
      expect((await loaded).type).toBe('image/png');
    });

    it('keeps the images tool off for a room that has no board record: the files would have nowhere to go', () => {
      fixture.componentRef.setInput('boardId', 'team-retro');
      fixture.detectChanges();

      expect(canvas().hasAttribute('images-enabled')).toBe(false);
    });

    it('shows why an image could not be stored, in the banner', async () => {
      await openStored();

      canvas().dispatchEvent(
        new CustomEvent('fileerror', { detail: { message: 'The image is too large.' } }),
      );

      expect(component.notice()).toBe('The image is too large.');
    });
  });

  describe('the token for the realtime connection', () => {
    const canvas = () =>
      fixture.nativeElement.querySelector('elysion-canvas') as HTMLElement & {
        tokenProvider?: () => Promise<string | null>;
      };
    const flushLookup = () =>
      http.match((req) => req.url.startsWith('/api/boards/')).forEach((r) => r.flush({}));

    beforeEach(() => {
      fixture.componentRef.setInput('boardId', 'team-retro');
      fixture.detectChanges();
    });

    it('is given to the canvas as a property, so it can ask again for every connection', () => {
      expect(typeof canvas().tokenProvider).toBe('function');
    });

    it('asks the BFF for a token for this board and hands it over', async () => {
      const token = canvas().tokenProvider!();

      const request = http.expectOne('/api/realtime/token');
      expect(request.request.method).toBe('POST');
      expect(request.request.body).toEqual({ boardId: 'team-retro' });
      request.flush({ token: 'ws-token-1', expiresAt: '2026-10-05T12:01:00Z' });

      expect(await token).toBe('ws-token-1');
      expect(component.notice()).toBeNull();
      flushLookup();
    });

    it('fetches a new token on every call: one token would be useless at the next reconnect', async () => {
      const first = canvas().tokenProvider!();
      http.expectOne('/api/realtime/token').flush({ token: 'one', expiresAt: 'x' });
      const second = canvas().tokenProvider!();
      http.expectOne('/api/realtime/token').flush({ token: 'two', expiresAt: 'x' });

      expect([await first, await second]).toEqual(['one', 'two']);
      flushLookup();
    });

    it('uses the board that is open now, also after the page was given another id', async () => {
      fixture.componentRef.setInput('boardId', 'other-board');
      fixture.detectChanges();
      flushLookup();

      const token = canvas().tokenProvider!();
      const request = http.expectOne('/api/realtime/token');
      expect(request.request.body).toEqual({ boardId: 'other-board' });
      request.flush({ token: 't', expiresAt: 'x' });
      await token;
    });

    it('says so, and tells the canvas not to connect, when the user has no access (403)', async () => {
      const token = canvas().tokenProvider!();

      http.expectOne('/api/realtime/token').flush(null, { status: 403, statusText: 'Forbidden' });

      expect(await token).toBeNull();
      expect(component.notice()).toBe('You no longer have access to this board.');
      fixture.detectChanges();
      expect(fixture.nativeElement.querySelector('.board-banner')?.textContent).toContain(
        'You no longer have access to this board.',
      );
      flushLookup();
    });

    it('passes any other failure on for the canvas to retry, without telling the user they lost access', async () => {
      const token = canvas().tokenProvider!().catch((e: unknown) => e);

      http.expectOne('/api/realtime/token').flush(null, { status: 502, statusText: 'Bad Gateway' });

      expect(await token).toMatchObject({ status: 502 });
      expect(component.notice()).toBeNull();
      flushLookup();
    });
  });

  describe('the shared timer', () => {
    type TimerCanvas = HTMLElement & {
      startTimer?: ReturnType<typeof vi.fn>;
      pauseTimer?: ReturnType<typeof vi.fn>;
      resumeTimer?: ReturnType<typeof vi.fn>;
      extendTimer?: ReturnType<typeof vi.fn>;
      stopTimer?: ReturnType<typeof vi.fn>;
    };
    const canvas = () => fixture.nativeElement.querySelector('elysion-canvas') as TimerCanvas;
    const bar = () => fixture.nativeElement.querySelector('app-top-bar') as HTMLElement;
    const state = {
      durationMs: 5 * 60_000,
      startedAt: Date.now(),
      pausedAt: null,
      remainingAtPauseMs: null,
      startedBy: { id: 'kc-1', name: 'Ada' },
    };
    const announce = (timer: unknown) => {
      canvas().dispatchEvent(new CustomEvent('timer', { detail: { state: timer } }));
      fixture.detectChanges();
    };
    const control = (label: string) =>
      bar().querySelector(`button[aria-label="${label}"]`) as HTMLButtonElement;

    it('tells the canvas who the user is, for the timer to remember who started it', () => {
      expect(canvas().getAttribute('user-id')).toBe(FAKE_USER.id);
    });

    it('shows the countdown the canvas announces, and removes it when the timer is gone', () => {
      expect(bar().querySelector('[role="timer"]')).toBeNull();

      announce(state);
      expect(bar().querySelector('[role="timer"] .clock')?.textContent?.trim()).toMatch(
        /^0[45]:\d\d$/,
      );

      announce(null);
      expect(bar().querySelector('[role="timer"]')).toBeNull();
    });

    it('starts a timer through the canvas from the Timer menu', () => {
      canvas().startTimer = vi.fn().mockResolvedValue(undefined);
      (bar().querySelector('app-timer-menu .menu-button') as HTMLButtonElement).click();
      fixture.detectChanges();
      (bar().querySelectorAll('.preset')[1] as HTMLElement).click(); // 2 min
      fixture.detectChanges();
      (bar().querySelector('.start') as HTMLElement).click();

      expect(canvas().startTimer).toHaveBeenCalledWith(2 * 60_000);
    });

    it('passes pause, resume, +1 min and stop on to the canvas', () => {
      Object.assign(canvas(), {
        pauseTimer: vi.fn().mockResolvedValue(undefined),
        resumeTimer: vi.fn().mockResolvedValue(undefined),
        extendTimer: vi.fn().mockResolvedValue(undefined),
        stopTimer: vi.fn().mockResolvedValue(undefined),
      });
      announce(state);

      control('Pause the timer').click();
      control('Add one minute to the timer').click();
      control('Stop the timer').click();
      announce({ ...state, pausedAt: state.startedAt, remainingAtPauseMs: 1000 });
      control('Resume the timer').click();

      expect(canvas().pauseTimer).toHaveBeenCalledTimes(1);
      expect(canvas().extendTimer).toHaveBeenCalledWith(60_000);
      expect(canvas().stopTimer).toHaveBeenCalledTimes(1);
      expect(canvas().resumeTimer).toHaveBeenCalledTimes(1);
    });

    it('says why the canvas refused, in the banner', async () => {
      canvas().stopTimer = vi.fn().mockRejectedValue(new Error('This board is read-only.'));
      announce(state);

      control('Stop the timer').click();
      await fixture.whenStable();

      expect(component.notice()).toBe('This board is read-only.');
    });

    it('says so, without an error, while the canvas has no timer methods yet', async () => {
      announce(state);

      expect(() => control('Stop the timer').click()).not.toThrow();
      await fixture.whenStable();

      expect(component.notice()).toBe('The canvas is not ready yet.');
    });
  });

  describe('dot voting', () => {
    type VotingCanvas = HTMLElement & {
      startVoting?: ReturnType<typeof vi.fn>;
      endVoting?: ReturnType<typeof vi.fn>;
      clearVotingResults?: ReturnType<typeof vi.fn>;
      scrollToElement?: ReturnType<typeof vi.fn>;
    };
    const canvas = () => fixture.nativeElement.querySelector('elysion-canvas') as VotingCanvas;
    const bar = () => fixture.nativeElement.querySelector('app-top-bar') as HTMLElement;
    const open = {
      id: 's1',
      name: 'Best idea',
      votesPerPerson: 5,
      status: 'open',
      startedBy: { id: 'kc-1', name: 'Ada' },
      myVotes: 1,
    };
    const closed = {
      ...open,
      status: 'closed',
      tally: [{ elementId: 'e1', count: 3, label: 'Ship it' }],
    };
    const announce = (session: unknown) => {
      canvas().dispatchEvent(new CustomEvent('voting', { detail: { session } }));
      fixture.detectChanges();
    };
    const menu = () => bar().querySelector('app-voting-menu') as HTMLElement;

    it('shows an editor a Voting button, then the votes left while a voting is open', () => {
      expect(menu().querySelector('.menu-button')?.textContent).toContain('Voting');

      announce(open);
      expect(menu().querySelector('.menu-button')?.textContent).toContain('4 left');

      announce(null);
      expect(menu().querySelector('.menu-button')?.textContent).not.toContain('left');
    });

    it('starts a voting through the canvas from the menu', () => {
      canvas().startVoting = vi.fn().mockResolvedValue(undefined);
      (menu().querySelector('.menu-button') as HTMLButtonElement).click();
      fixture.detectChanges();
      (menu().querySelectorAll('.preset')[0] as HTMLElement).click(); // 3 votes
      fixture.detectChanges();
      (menu().querySelector('button[type="submit"]') as HTMLElement).click();

      expect(canvas().startVoting).toHaveBeenCalledWith({ name: 'Voting', votesPerPerson: 3 });
    });

    it('ends the voting and clears the results through the canvas', () => {
      Object.assign(canvas(), {
        endVoting: vi.fn().mockResolvedValue(undefined),
        clearVotingResults: vi.fn().mockResolvedValue(undefined),
      });
      announce(open);
      (menu().querySelector('.menu-button') as HTMLButtonElement).click();
      fixture.detectChanges();
      (menu().querySelector('.end') as HTMLElement).click();
      expect(canvas().endVoting).toHaveBeenCalledTimes(1);

      announce(closed); // the results open by themselves
      (menu().querySelector('.clear') as HTMLElement).click();
      fixture.detectChanges();
      (menu().querySelector('.clear') as HTMLElement).click();
      expect(canvas().clearVotingResults).toHaveBeenCalledTimes(1);
    });

    it('shows the results by themselves when the voting is closed, whoever closed it', () => {
      announce(open);
      expect(menu().querySelector('.results-dialog')).toBeNull();

      announce(closed);

      expect(menu().querySelector('.results-dialog')).toBeTruthy();
    });

    it('scrolls the canvas to the element of a clicked result', () => {
      canvas().scrollToElement = vi.fn().mockResolvedValue(undefined);
      announce(closed);
      (menu().querySelector('.menu-button') as HTMLButtonElement).click();
      fixture.detectChanges();

      (menu().querySelector('.result') as HTMLElement).click();

      expect(canvas().scrollToElement).toHaveBeenCalledWith('e1');
    });

    it('says why the canvas refused, in the banner', async () => {
      canvas().endVoting = vi.fn().mockRejectedValue(new Error('This board is read-only.'));
      announce(open);
      (menu().querySelector('.menu-button') as HTMLButtonElement).click();
      fixture.detectChanges();

      (menu().querySelector('.end') as HTMLElement).click();
      await fixture.whenStable();

      expect(component.notice()).toBe('This board is read-only.');
    });
  });

  describe('roles', () => {
    const uuid = '0197a8d2-1c3e-7a10-8000-000000000001';
    const canvas = () =>
      fixture.nativeElement.querySelector('elysion-canvas') as HTMLElement | null;
    const bar = () => fixture.nativeElement.querySelector('app-top-bar') as HTMLElement;

    /** Opens a stored board and answers what the BFF is asked: the board, and the user's role on it. */
    const openAs = async (role: string | null) => {
      fixture.componentRef.setInput('boardId', uuid);
      fixture.detectChanges();
      await fixture.whenStable();
      http
        .expectOne(`/api/boards/${uuid}`)
        .flush({ id: uuid, name: 'Retro', createdAt: '', path: '' });
      const request = http.expectOne(`/api/boards/${uuid}/membership/me`);
      if (role === null) {
        request.flush(null, { status: 404, statusText: 'Not Found' });
      } else {
        request.flush({ boardId: uuid, role });
      }
      await fixture.whenStable();
      fixture.detectChanges();
    };

    it('gives an owner the Share button, and the dialog when it is pressed', async () => {
      await openAs('owner');
      expect(bar().querySelector('.share-button')).toBeTruthy();
      expect(fixture.nativeElement.querySelector('app-share-dialog')).toBeNull();
      // The dialog's code is a deferred block (#710): it has not been loaded until the button is pressed.
      expect(await fixture.getDeferBlocks()).toHaveLength(1);

      (bar().querySelector('.share-button') as HTMLButtonElement).click();
      await fixture.whenStable();
      fixture.detectChanges();
      await (await fixture.getDeferBlocks())[0]?.render(DeferBlockState.Complete);
      fixture.detectChanges();

      expect(fixture.nativeElement.querySelector('app-share-dialog')).toBeTruthy();
      http.expectOne(`/api/boards/${uuid}/members`).flush([]);

      fixture.debugElement.query(By.directive(ShareDialog)).componentInstance.closed.emit();
      fixture.detectChanges();
      expect(fixture.nativeElement.querySelector('app-share-dialog')).toBeNull();
    });

    it('gives an editor no Share button and a canvas that is not read-only', async () => {
      await openAs('editor');

      expect(bar().querySelector('.share-button')).toBeNull();
      expect(canvas()!.hasAttribute('readonly')).toBe(false);
      expect(bar().querySelector('.import-button')).toBeTruthy();
    });

    it('gives a viewer a read-only canvas and no Import, Library or Share', async () => {
      await openAs('viewer');

      expect(canvas()!.hasAttribute('readonly')).toBe(true);
      expect(bar().querySelector('.import-button')).toBeNull();
      expect(bar().querySelector('.library-toggle')).toBeNull();
      expect(bar().querySelector('.share-button')).toBeNull();
    });

    it('shows a viewer the timer and no way to start or change it', async () => {
      await openAs('viewer');
      canvas()!.dispatchEvent(
        new CustomEvent('timer', {
          detail: {
            state: {
              durationMs: 60_000,
              startedAt: Date.now(),
              pausedAt: null,
              remainingAtPauseMs: null,
              startedBy: { id: 'someone', name: 'Bea' },
            },
          },
        }),
      );
      fixture.detectChanges();

      expect(bar().querySelector('[role="timer"]')).toBeTruthy();
      for (const label of ['Pause the timer', 'Add one minute to the timer', 'Stop the timer']) {
        expect(bar().querySelector(`button[aria-label="${label}"]`)).toBeNull();
      }
      canvas()!.dispatchEvent(new CustomEvent('timer', { detail: { state: null } }));
      fixture.detectChanges();
      expect(bar().querySelector('app-timer-menu .menu-button')).toBeNull();
    });

    it('shows a viewer the state of a voting and its results, and nothing to start or change', async () => {
      await openAs('viewer');
      const announce = (session: unknown) => {
        canvas()!.dispatchEvent(new CustomEvent('voting', { detail: { session } }));
        fixture.detectChanges();
      };
      const menu = () => bar().querySelector('app-voting-menu') as HTMLElement;
      expect(menu().querySelector('.menu-button')).toBeNull(); // nothing without a voting

      announce({
        id: 's1',
        name: 'Pick',
        votesPerPerson: 3,
        status: 'open',
        startedBy: { id: 'someone', name: 'Bea' },
        myVotes: 0,
      });
      expect(menu().querySelector('.chip')?.textContent).toContain('Voting: Pick');
      expect(menu().querySelector('.menu-button')).toBeNull();

      announce({
        id: 's1',
        name: 'Pick',
        votesPerPerson: 3,
        status: 'closed',
        startedBy: { id: 'someone', name: 'Bea' },
        myVotes: 0,
        tally: [{ elementId: 'e1', count: 2, label: 'Ship it' }],
      });
      fixture.detectChanges();
      expect(menu().querySelector('.result')).toBeTruthy(); // opened by themselves
      expect(menu().querySelector('.clear')).toBeNull();
      expect(menu().querySelector('form')).toBeNull();
    });

    it('gives an editor the Timer menu', async () => {
      await openAs('editor');

      expect(bar().querySelector('app-timer-menu .menu-button')).toBeTruthy();
    });

    it("does not start the canvas before the role is known, so a viewer never gets an editor's canvas first", async () => {
      fixture.componentRef.setInput('boardId', uuid);
      fixture.detectChanges();
      await fixture.whenStable();
      http
        .expectOne(`/api/boards/${uuid}`)
        .flush({ id: uuid, name: 'Retro', createdAt: '', path: '' });
      await fixture.whenStable();
      fixture.detectChanges();

      expect(canvas()).toBeNull();

      http.expectOne(`/api/boards/${uuid}/membership/me`).flush({ boardId: uuid, role: 'viewer' });
      await fixture.whenStable();
      fixture.detectChanges();
      expect(canvas()!.hasAttribute('readonly')).toBe(true);
    });

    it('treats a user without a role like an editor in the interface: the backend refuses what they may not do', async () => {
      await openAs(null);

      expect(canvas()!.hasAttribute('readonly')).toBe(false);
      expect(bar().querySelector('.share-button')).toBeNull();
    });

    it('asks nothing for a room that is no stored board', async () => {
      fixture.componentRef.setInput('boardId', 'default');
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();

      http.expectNone('/api/boards/default/membership/me');
      expect(canvas()).toBeTruthy();
    });
  });

  describe('a template chosen when the board was created', () => {
    const uuid = '0197a8d2-1c3e-7a10-8000-000000000002';
    const SCENE = '{"type":"excalidraw","version":2,"elements":[]}';
    let importFile: ReturnType<typeof vi.fn>;

    /** Opens a new stored board the way the board list does: the template travels in the history state. */
    const openNewBoard = async (state: unknown = { templateId: 't1' }, role = 'owner') => {
      TestBed.inject(Location).replaceState('/', '', state);
      fixture = TestBed.createComponent(Board);
      component = fixture.componentInstance;
      fixture.componentRef.setInput('boardId', uuid);
      fixture.detectChanges();
      await fixture.whenStable();
      http
        .expectOne(`/api/boards/${uuid}`)
        .flush({ id: uuid, name: 'New', createdAt: '', path: '' });
      http.expectOne(`/api/boards/${uuid}/membership/me`).flush({ boardId: uuid, role });
      await fixture.whenStable();
      fixture.detectChanges();
      const canvas: HTMLElement & { importFile?: unknown } =
        fixture.nativeElement.querySelector('elysion-canvas');
      importFile = vi.fn().mockResolvedValue(3);
      canvas.importFile = importFile;
      return canvas;
    };

    const connect = async (canvas: HTMLElement) => {
      canvas.dispatchEvent(new CustomEvent('ready'));
      canvas.dispatchEvent(new CustomEvent('status', { detail: { status: 'connected' } }));
      fixture.detectChanges();
      await fixture.whenStable();
    };

    it('writes the template into the canvas once it is connected, and only once', async () => {
      const canvas = await openNewBoard();

      await connect(canvas);
      http.expectOne('/api/templates/t1').flush({ id: 't1', scene: SCENE });
      await fixture.whenStable();

      expect(importFile).toHaveBeenCalledOnce();
      const blob = importFile.mock.calls[0][0] as Blob;
      expect(await blob.text()).toBe(SCENE);

      // A reconnect does not apply it again, and a reload finds no marker in the history any more.
      canvas.dispatchEvent(new CustomEvent('status', { detail: { status: 'disconnected' } }));
      await connect(canvas);
      http.expectNone('/api/templates/t1');
      expect(importFile).toHaveBeenCalledOnce();
      expect(
        (TestBed.inject(Location).getState() as Record<string, unknown>)['templateId'],
      ).toBeUndefined();
    });

    it('waits for the connection', async () => {
      await openNewBoard();

      http.expectNone('/api/templates/t1');
      expect(importFile).not.toHaveBeenCalled();
    });

    it('does nothing for a board opened without a template, as everybody else does', async () => {
      const canvas = await openNewBoard({});

      await connect(canvas);

      http.expectNone('/api/templates/t1');
      expect(importFile).not.toHaveBeenCalled();
    });

    it('tells the user when the template cannot be applied', async () => {
      const canvas = await openNewBoard();

      await connect(canvas);
      http.expectOne('/api/templates/t1').flush(null, { status: 502, statusText: 'Bad Gateway' });
      await fixture.whenStable();
      fixture.detectChanges();

      expect(importFile).not.toHaveBeenCalled();
      expect(fixture.nativeElement.textContent).toContain('The template could not be applied');
    });
  });

  describe('adding a template to the board', () => {
    const SCENE = '{"type":"excalidraw","version":2,"elements":[]}';
    const canvas = () => fixture.nativeElement.querySelector('elysion-canvas') as HTMLElement;

    it('inserts the scene through the canvas, next to what is there', async () => {
      const insertFile = vi.fn().mockResolvedValue(6);
      (canvas() as unknown as { insertFile: unknown }).insertFile = insertFile;

      const done = component.addTemplate('t1');
      http.expectOne('/api/templates/t1').flush({ id: 't1', scene: SCENE });
      await done;

      expect(insertFile).toHaveBeenCalledOnce();
      expect(await (insertFile.mock.calls[0][0] as Blob).text()).toBe(SCENE);
    });

    it('says so when the canvas is not ready, without asking for the template', async () => {
      await component.addTemplate('t1');

      http.expectNone('/api/templates/t1');
      expect(component.notice()).toBe('The canvas is not ready yet.');
    });

    it('says so when the template cannot be fetched', async () => {
      (canvas() as unknown as { insertFile: unknown }).insertFile = vi.fn();

      const done = component.addTemplate('t1');
      http.expectOne('/api/templates/t1').flush(null, { status: 502, statusText: 'Bad Gateway' });
      await done;

      expect(component.notice()).toBe('The template could not be added.');
    });
  });

  describe('saving the board as a template', () => {
    const SCENE = '{"type":"excalidraw","version":2,"elements":[{}]}';
    const canvas = () => fixture.nativeElement.querySelector('elysion-canvas') as HTMLElement;
    const form = () => fixture.nativeElement.querySelector('form.save-template') as HTMLFormElement;
    const field = (name: string) => form().querySelector(`[name="${name}"]`) as HTMLInputElement;
    const type = async (name: string, value: string) => {
      field(name).value = value;
      field(name).dispatchEvent(new Event('input'));
      await fixture.whenStable();
    };
    const submit = async () => {
      form().dispatchEvent(new Event('submit'));
      await fixture.whenStable();
    };
    let exportBoard: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      exportBoard = vi.fn().mockResolvedValue(new Blob([SCENE]));
      (canvas() as unknown as { exportBoard: unknown }).exportBoard = exportBoard;
    });

    const open = async (selectionOnly = false) => {
      component.startSaveTemplate(selectionOnly);
      fixture.detectChanges();
      await fixture.whenStable();
    };

    it('asks for a name and a description, and starts with the board or selection', async () => {
      await open();
      expect(form()).toBeTruthy();
      expect(field('template-name').value).toBe('Board');

      component.cancelSaveTemplate();
      await open(true);
      expect(field('template-name').value).toBe('Selection');
    });

    it('exports the scene and stores it as the user template', async () => {
      await open();
      await type('template-name', '  Planning  ');
      await type('template-description', 'A start');

      await submit();
      const request = http.expectOne('/api/templates');
      expect(request.request.method).toBe('POST');
      expect(request.request.body).toEqual({
        name: 'Planning',
        description: 'A start',
        scene: SCENE,
      });
      request.flush({ id: 't9' });
      await fixture.whenStable();
      fixture.detectChanges();

      expect(exportBoard).toHaveBeenCalledWith('excalidraw', { selectionOnly: false });
      expect(form()).toBeNull();
      expect(component.notice()).toBe('Saved the template “Planning”.');
    });

    it('saves only the selection when asked to', async () => {
      await open(true);

      await submit();
      http.expectOne('/api/templates').flush({ id: 't9' });
      await fixture.whenStable();

      expect(exportBoard).toHaveBeenCalledWith('excalidraw', { selectionOnly: true });
    });

    it('does not save without a name', async () => {
      await open();
      await type('template-name', '   ');

      await submit();
      fixture.detectChanges();

      http.expectNone('/api/templates');
      expect(form().textContent).toContain('Give the template a name.');
    });

    it('says so when there is nothing to save, and closes the form', async () => {
      exportBoard.mockResolvedValue(null);
      await open(true);

      await submit();
      fixture.detectChanges();

      http.expectNone('/api/templates');
      expect(component.notice()).toBe('Nothing is selected.');
      expect(form()).toBeNull();
    });

    it('keeps the form with what was typed when saving fails, and allows a retry', async () => {
      await open();
      await type('template-name', 'Planning');

      await submit();
      http.expectOne('/api/templates').flush(null, { status: 502, statusText: 'Bad Gateway' });
      await fixture.whenStable();
      fixture.detectChanges();

      expect(form().textContent).toContain('could not be saved');
      expect(field('template-name').value).toBe('Planning');
      await submit();
      http.expectOne('/api/templates').flush({ id: 't9' });
    });
  });
});
