import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CanvasApp, type CanvasControls } from './CanvasApp';
import { excalidrawReady } from './test-utils';

/** Draws with a tool on the interactive canvas: press, move, release (jsdom has no layout: client = canvas coordinates). */
function drag(canvas: Element, from: [number, number], to: [number, number]) {
  const init = (point: [number, number]) => ({
    clientX: point[0],
    clientY: point[1],
    pointerId: 1,
    pointerType: 'mouse',
    button: 0,
    buttons: 1,
  });
  fireEvent.pointerDown(canvas, init(from));
  fireEvent.pointerMove(canvas, init([(from[0] + to[0]) / 2, (from[1] + to[1]) / 2]));
  fireEvent.pointerMove(canvas, init(to));
  fireEvent.pointerUp(canvas, { ...init(to), buttons: 0 });
}

describe('the Connector tool', () => {
  it('draws a right-angled arrow that is bound to both shapes it starts and ends on', async () => {
    const onControls = vi.fn();
    const { container } = render(<CanvasApp boardId="test-board" onControls={onControls} />);
    await excalidrawReady(container);
    const controls: CanvasControls = onControls.mock.calls[0][0];
    const canvas = container.querySelector('canvas.interactive') as Element;

    const rectangles: [[number, number], [number, number]][] = [
      [
        [100, 100],
        [260, 200],
      ],
      [
        [500, 300],
        [660, 400],
      ],
    ];
    for (const [from, to] of rectangles) {
      fireEvent.click(screen.getByRole('button', { name: 'Rectangle' }));
      drag(canvas, from, to);
    }
    fireEvent.click(screen.getByRole('button', { name: 'Connector' }));
    drag(canvas, [180, 150], [580, 350]); // from inside the first rectangle to inside the second

    const scene = JSON.parse(await ((await controls.exportBoard('excalidraw')) as Blob).text());
    const shapes = scene.elements.filter((e: { type: string }) => e.type === 'rectangle');
    const arrow = scene.elements.find((e: { type: string }) => e.type === 'arrow');
    expect(arrow).toBeTruthy();
    expect(arrow.elbowed).toBe(true);
    expect(arrow.endArrowhead).toBe('arrow');
    expect(arrow.startArrowhead).toBeNull();
    expect([arrow.startBinding?.elementId, arrow.endBinding?.elementId].sort()).toEqual(
      shapes.map((s: { id: string }) => s.id).sort(),
    );
  }, 20000);
});
