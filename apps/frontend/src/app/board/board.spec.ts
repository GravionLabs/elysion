import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
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

    it('keeps showing the id when the board has no record', async () => {
      fixture.componentRef.setInput('boardId', id);
      fixture.detectChanges();
      await fixture.whenStable();

      http.expectOne(`/api/boards/${id}`).flush('', { status: 404, statusText: 'Not Found' });
      await fixture.whenStable();
      fixture.detectChanges();

      expect(title()).toContain(id);
    });

    it('does not ask the BFF about a room such as default', async () => {
      fixture.componentRef.setInput('boardId', 'default');
      fixture.detectChanges();
      await fixture.whenStable();

      http.expectNone(() => true);
      expect(title()).toContain('default');
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
});
