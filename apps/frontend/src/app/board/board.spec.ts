import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Board } from './board';
import { CanvasElementLoader } from './canvas-element-loader';

describe('Board', () => {
  let component: Board;
  let fixture: ComponentFixture<Board>;
  let loader: { load: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    loader = { load: vi.fn().mockResolvedValue(undefined) };

    await TestBed.configureTestingModule({
      imports: [Board],
      providers: [{ provide: CanvasElementLoader, useValue: loader }],
    }).compileComponents();

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
