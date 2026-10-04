import { act, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Minimap } from './Minimap';
import { computeLayout, type SceneSnapshot } from './minimap-geometry';
import { MINIMAP_SIZE } from './Minimap';
import { SceneStore } from './scene-store';

const snapshot: SceneSnapshot = {
  elements: [{ x: 0, y: 0, width: 400, height: 300 }],
  scrollX: 0,
  scrollY: 0,
  zoom: 1,
  width: 800,
  height: 600,
};

describe('Minimap', () => {
  it('renders nothing while the scene is empty', () => {
    const store = new SceneStore();
    const { container } = render(<Minimap store={store} onPan={() => {}} />);
    expect(container.firstChild).toBeNull();

    act(() => store.set({ ...snapshot, elements: [] }));
    expect(container.firstChild).toBeNull();
  });

  it('appears once the scene has content', () => {
    const store = new SceneStore();
    render(<Minimap store={store} onPan={() => {}} />);
    act(() => store.set(snapshot));

    expect(screen.getByRole('group', { name: 'Canvas overview' })).toBeTruthy();
  });

  it('reports the scene point under a click so the host can center it', () => {
    const store = new SceneStore();
    const onPan = vi.fn();
    const { container } = render(<Minimap store={store} onPan={onPan} />);
    act(() => store.set(snapshot));

    const canvas = container.querySelector('canvas') as HTMLCanvasElement;
    canvas.getBoundingClientRect = () => ({ left: 10, top: 20 }) as DOMRect;
    // jsdom has no PointerEvent; React only reads clientX/clientY off the event.
    act(() => {
      canvas.dispatchEvent(
        new MouseEvent('pointerdown', { clientX: 10 + 80, clientY: 20 + 60, bubbles: true }),
      );
    });

    expect(onPan).toHaveBeenCalledTimes(1);
    const { x, y } = onPan.mock.calls[0][0];
    // The viewport (800x600) is the biggest rect, so the minimap center maps to the scene center.
    expect(x).toBeCloseTo(400, 0);
    expect(y).toBeCloseTo(300, 0);
  });
});

const nextFrame = () =>
  act(async () => {
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  });

const pointer = (canvas: HTMLCanvasElement, type: string, x: number, y: number) =>
  act(() => {
    canvas.dispatchEvent(new MouseEvent(type, { clientX: x, clientY: y, bubbles: true }));
  });

describe('Minimap while and after moving the view through it', () => {
  const lastFrame = (canvas: HTMLCanvasElement) => {
    const context = canvas.getContext('2d') as unknown as {
      strokeRect: { mock: { calls: number[][] } };
    };
    return context.strokeRect.mock.calls.at(-1);
  };

  it('re-fits the minimap to the current scene after the pointer is released', async () => {
    const store = new SceneStore();
    const { container } = render(<Minimap store={store} onPan={() => {}} />);
    act(() => store.set(snapshot));
    await nextFrame();
    const canvas = container.querySelector('canvas') as HTMLCanvasElement;
    canvas.getBoundingClientRect = () => ({ left: 0, top: 0 }) as DOMRect;

    pointer(canvas, 'pointerdown', 80, 60);
    // The host scrolls the view far to the right; the last change arrives before the pointer is released.
    const moved = { ...snapshot, scrollX: -3000 };
    act(() => store.set(moved));
    await nextFrame();
    pointer(canvas, 'pointerup', 80, 60);
    await nextFrame();

    const fresh = computeLayout(moved, MINIMAP_SIZE).viewport;
    expect(lastFrame(canvas)).toEqual([fresh.x, fresh.y, fresh.width, fresh.height]);
  });

  it('does not send the view beyond the content when the pointer leaves the minimap', () => {
    const store = new SceneStore();
    const onPan = vi.fn();
    const { container } = render(<Minimap store={store} onPan={onPan} />);
    act(() => store.set(snapshot));
    const canvas = container.querySelector('canvas') as HTMLCanvasElement;
    canvas.getBoundingClientRect = () => ({ left: 0, top: 0 }) as DOMRect;

    pointer(canvas, 'pointerdown', 80, 60);
    pointer(canvas, 'pointermove', 5000, 5000);

    const edge = computeLayout(snapshot, MINIMAP_SIZE);
    const farthest = onPan.mock.calls.at(-1)![0];
    // A pointer far outside is treated as being on the minimap's bottom-right corner.
    const cornerX = MINIMAP_SIZE.width / edge.scale + edge.originX;
    const cornerY = MINIMAP_SIZE.height / edge.scale + edge.originY;
    expect(farthest.x).toBeCloseTo(cornerX);
    expect(farthest.y).toBeCloseTo(cornerY);
  });
});
