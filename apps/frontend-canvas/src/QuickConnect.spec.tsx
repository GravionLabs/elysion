import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CanvasApp, type CanvasControls } from './CanvasApp';
import { excalidrawReady } from './test-utils';

type Point = [number, number];

function drag(canvas: Element, from: Point, to: Point) {
  const init = (point: Point, buttons = 1) => ({
    clientX: point[0],
    clientY: point[1],
    pointerId: 1,
    pointerType: 'mouse',
    button: 0,
    buttons,
  });
  fireEvent.pointerDown(canvas, init(from));
  fireEvent.pointerMove(canvas, init([(from[0] + to[0]) / 2, (from[1] + to[1]) / 2]));
  fireEvent.pointerMove(canvas, init(to));
  fireEvent.pointerUp(canvas, init(to, 0));
}

/** Two rectangles on the board: the left (100,100)-(260,200), the right (500,300)-(660,400). */
async function setup(options: { readOnly?: boolean } = {}) {
  const onControls = vi.fn();
  const { container } = render(
    <CanvasApp boardId="test-board" onControls={onControls} readOnly={options.readOnly} />,
  );
  await excalidrawReady(container);
  const controls: CanvasControls = onControls.mock.calls[0][0];
  const canvas = container.querySelector('canvas.interactive') as Element;
  const scene = async () =>
    JSON.parse(await ((await controls.exportBoard('excalidraw')) as Blob).text()).elements as {
      id: string;
      type: string;
      isDeleted?: boolean;
      startBinding?: { elementId: string } | null;
      endBinding?: { elementId: string } | null;
    }[];
  const arrows = async () => (await scene()).filter((e) => e.type === 'arrow' && !e.isDeleted);
  const connectButton = () => screen.queryByRole('button', { name: 'Connect' });
  const draw = (from: Point, to: Point) => {
    fireEvent.click(screen.getByRole('button', { name: 'Rectangle' }));
    drag(canvas, from, to);
  };
  const pressOnCanvas = (init: KeyboardEventInit) =>
    fireEvent.keyDown(container.querySelector('.excalidraw')!, init);
  /** Select all, from an empty selection when `fresh` (then no order of picking is known). */
  const clearSelection = () => {
    fireEvent.pointerDown(canvas, { clientX: 900, clientY: 700, pointerId: 1, buttons: 1 });
    fireEvent.pointerUp(canvas, { clientX: 900, clientY: 700, pointerId: 1, buttons: 0 });
  };
  const selectAll = (fresh = true) => {
    if (fresh) clearSelection();
    pressOnCanvas({ key: 'a', code: 'KeyA', ctrlKey: true, metaKey: true });
  };
  const withBoth = async () => {
    draw([100, 100], [260, 200]);
    draw([500, 300], [660, 400]);
    return { selectAll };
  };
  return {
    container,
    canvas,
    scene,
    arrows,
    connectButton,
    draw,
    selectAll,
    clearSelection,
    withBoth,
  };
}

describe('connecting the two selected elements', () => {
  it('shows a Connect button for exactly two selected shapes, not for one', async () => {
    const { draw, selectAll, connectButton } = await setup();

    draw([100, 100], [260, 200]);
    await waitFor(() => expect(connectButton()).toBeNull()); // one shape selected: the one just drawn
    draw([500, 300], [660, 400]);
    expect(connectButton()).toBeNull();

    selectAll();
    await waitFor(() => expect(connectButton()).toBeTruthy());
    expect(connectButton()?.getAttribute('title')).toBe('Connect the two selected elements (C)');
  });

  it('connects them with one elbow connector from the left to the right shape when the button is pressed', async () => {
    const { withBoth, connectButton, arrows, scene } = await setup();
    const { selectAll } = await withBoth();
    selectAll();
    await waitFor(() => expect(connectButton()).toBeTruthy());

    fireEvent.click(connectButton()!);

    await waitFor(async () => expect(await arrows()).toHaveLength(1));
    const [arrow] = (await arrows()) as unknown as {
      elbowed: boolean;
      startBinding: { elementId: string };
      endBinding: { elementId: string };
    }[];
    const shapes = (await scene()).filter((e) => e.type === 'rectangle');
    expect(arrow.elbowed).toBe(true);
    expect(arrow.startBinding.elementId).toBe(shapes[0].id); // the left one: the order of a select all is not known
    expect(arrow.endBinding.elementId).toBe(shapes[1].id);
  });

  it('starts at the element that was picked first when the order is known', async () => {
    const { withBoth, connectButton, arrows, scene } = await setup();
    const { selectAll } = await withBoth(); // the right rectangle is selected, as the last one drawn
    selectAll(false); // adds the left one to it: the right one was picked first
    await waitFor(() => expect(connectButton()).toBeTruthy());

    fireEvent.click(connectButton()!);

    await waitFor(async () => expect(await arrows()).toHaveLength(1));
    const [arrow] = (await arrows()) as unknown as { startBinding: { elementId: string } }[];
    const shapes = (await scene()).filter((e) => e.type === 'rectangle');
    expect(arrow.startBinding.elementId).toBe(shapes[1].id);
  });

  it('does the same with the key C, once: a second C adds no second connector', async () => {
    const { withBoth, arrows } = await setup();
    const { selectAll } = await withBoth();
    selectAll();

    fireEvent.keyDown(window, { key: 'c' });
    await waitFor(async () => expect(await arrows()).toHaveLength(1));
    // The new connector is selected now; select both shapes again and press C again.
    selectAll();
    fireEvent.keyDown(window, { key: 'c' });

    expect(await arrows()).toHaveLength(1);
  });

  it('is one undo step', async () => {
    const { withBoth, arrows } = await setup();
    const { selectAll } = await withBoth();
    selectAll();
    fireEvent.keyDown(window, { key: 'c' });
    await waitFor(async () => expect(await arrows()).toHaveLength(1));

    fireEvent.click(
      within(screen.getByRole('toolbar', { name: 'Canvas tools' })).getByRole('button', {
        name: 'Undo',
      }),
    );

    await waitFor(async () => expect(await arrows()).toHaveLength(0));
  });

  it('ignores C with a modifier (copy), while typing in a field and with nothing connectable selected', async () => {
    const { withBoth, arrows, clearSelection } = await setup();
    const { selectAll } = await withBoth();
    selectAll();
    const input = document.createElement('input');
    document.body.appendChild(input);

    fireEvent.keyDown(window, { key: 'c', ctrlKey: true });
    fireEvent.keyDown(window, { key: 'c', metaKey: true });
    fireEvent.keyDown(input, { key: 'c' });
    expect(await arrows()).toHaveLength(0);

    clearSelection();
    fireEvent.keyDown(window, { key: 'c' });
    expect(await arrows()).toHaveLength(0);
    input.remove();
  });

  it('has no Connect button on a read-only board', async () => {
    const { connectButton } = await setup({ readOnly: true });

    expect(connectButton()).toBeNull();
  });
});
