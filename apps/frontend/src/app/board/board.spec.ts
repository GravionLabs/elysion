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

  it('renders an elysion-canvas element', () => {
    const el = fixture.nativeElement.querySelector('elysion-canvas');
    expect(el).toBeTruthy();
  });
});
