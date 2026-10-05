import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
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
