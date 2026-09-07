import { TestBed } from '@angular/core/testing';
import { CanvasElementLoader } from './canvas-element-loader';

describe('CanvasElementLoader', () => {
  let loader: CanvasElementLoader;

  beforeEach(() => {
    document.head.querySelectorAll('script').forEach((el) => el.remove());
    TestBed.configureTestingModule({});
    loader = TestBed.inject(CanvasElementLoader);
  });

  it('appends a module script tag with the given src', () => {
    void loader.load('/canvas/elysion-canvas.js');

    const script = document.head.querySelector<HTMLScriptElement>(
      'script[src="/canvas/elysion-canvas.js"]',
    );
    expect(script).toBeTruthy();
    expect(script?.type).toBe('module');
  });

  it('only appends the script once across repeated calls', () => {
    void loader.load('/canvas/elysion-canvas.js');
    void loader.load('/canvas/elysion-canvas.js');

    expect(document.head.querySelectorAll('script[src="/canvas/elysion-canvas.js"]')).toHaveLength(
      1,
    );
  });
});
