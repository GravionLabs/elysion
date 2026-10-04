import { act, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Minimap } from './Minimap';
import type { SceneSnapshot } from './minimap-geometry';
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
