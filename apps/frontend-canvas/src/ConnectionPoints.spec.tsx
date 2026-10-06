import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CanvasApp, type CanvasControls } from './CanvasApp';
import { excalidrawReady } from './test-utils';

type Point = [number, number];

/** Draws with the active tool on the interactive canvas (jsdom has no layout: client = canvas coordinates). */
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

const points = (container: HTMLElement) => [
  ...container.querySelectorAll<HTMLElement>('[data-connection-point]'),
];

/** Two rectangles, left (100,100)-(260,200) and right (500,300)-(660,400), and the canvas to drive them. */
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
      elbowed?: boolean;
    }[];
  const draw = (from: Point, to: Point) => {
    fireEvent.click(screen.getByRole('button', { name: 'Rectangle' }));
    drag(canvas, from, to);
  };
  return { container, controls, canvas, scene, draw };
}

describe('connection points', () => {
  it('show on the shape that was just drawn (it is selected), four per shape', async () => {
    const { container, draw } = await setup();

    draw([100, 100], [260, 200]);

    await waitFor(() => expect(points(container)).toHaveLength(4));
    expect(points(container).map((p) => p.dataset['connectionPoint']?.split(':')[1])).toEqual([
      'top',
      'right',
      'bottom',
      'left',
    ]);
  });

  it('show on a hovered shape and go when the pointer leaves it', async () => {
    const { container, canvas, draw } = await setup();
    draw([100, 100], [260, 200]);
    draw([500, 300], [660, 400]);
    fireEvent.pointerDown(canvas, { clientX: 900, clientY: 700, pointerId: 1, buttons: 1 }); // deselect
    fireEvent.pointerUp(canvas, { clientX: 900, clientY: 700, pointerId: 1, buttons: 0 });
    await waitFor(() => expect(points(container)).toHaveLength(0));

    fireEvent.pointerMove(container.querySelector('.elysion-canvas')!, {
      clientX: 180,
      clientY: 150,
      buttons: 0,
    });
    await waitFor(() => expect(points(container)).toHaveLength(4));

    fireEvent.pointerMove(container.querySelector('.elysion-canvas')!, {
      clientX: 900,
      clientY: 700,
      buttons: 0,
    });
    await waitFor(() => expect(points(container)).toHaveLength(0));
  });

  it('are not shown on a read-only board', async () => {
    const { container } = await setup({ readOnly: true });

    expect(container.querySelector('.elysion-connection-points')).toBeNull();
  });

  it('are not part of the scene or of an export', async () => {
    const { container, controls, draw, scene } = await setup();
    draw([100, 100], [260, 200]);
    await waitFor(() => expect(points(container)).toHaveLength(4));

    expect((await scene()).map((e) => e.type)).toEqual(['rectangle']);
    const svg = await ((await controls.exportBoard('svg')) as Blob).text();
    expect(svg).not.toContain('connection-point');
  });
});

describe('connecting by dragging a point', () => {
  /** Draws both rectangles, hovers the left one and returns its right-hand circle. */
  async function prepare() {
    const context = await setup();
    context.draw([100, 100], [260, 200]);
    context.draw([500, 300], [660, 400]);
    fireEvent.pointerDown(context.canvas, { clientX: 900, clientY: 700, pointerId: 1, buttons: 1 });
    fireEvent.pointerUp(context.canvas, { clientX: 900, clientY: 700, pointerId: 1, buttons: 0 });
    fireEvent.pointerMove(context.container.querySelector('.elysion-canvas')!, {
      clientX: 180,
      clientY: 150,
      buttons: 0,
    });
    await waitFor(() => expect(points(context.container)).toHaveLength(4));
    const right = points(context.container).find((p) =>
      p.dataset['connectionPoint']?.endsWith(':right'),
    )!;
    return { ...context, right };
  }

  const pointer = (point: Point, buttons = 1) => ({
    clientX: point[0],
    clientY: point[1],
    pointerId: 2,
    pointerType: 'mouse',
    buttons,
  });

  it('creates one right-angled connector bound to both shapes when released over the other shape', async () => {
    const { right, scene } = await prepare();

    fireEvent.pointerDown(right, pointer([272, 150]));
    fireEvent.pointerMove(right, pointer([400, 250]));
    fireEvent.pointerMove(right, pointer([580, 350]));
    fireEvent.pointerUp(right, pointer([580, 350], 0));

    await waitFor(async () =>
      expect((await scene()).filter((e) => e.type === 'arrow')).toHaveLength(1),
    );
    const elements = await scene();
    const shapes = elements.filter((e) => e.type === 'rectangle');
    const arrow = elements.find((e) => e.type === 'arrow')!;
    expect(arrow.elbowed).toBe(true);
    expect(arrow.startBinding?.elementId).toBe(shapes[0].id);
    expect(arrow.endBinding?.elementId).toBe(shapes[1].id);
  });

  it('draws a preview line while dragging and none afterwards', async () => {
    const { container, right } = await prepare();

    fireEvent.pointerDown(right, pointer([272, 150]));
    fireEvent.pointerMove(right, pointer([400, 250]));
    await waitFor(() =>
      expect(container.querySelector('.elysion-connector-preview line')).toBeTruthy(),
    );

    fireEvent.pointerMove(right, pointer([180, 150]));
    fireEvent.pointerUp(right, pointer([180, 150], 0)); // back on the source: cancelled
    await waitFor(() => expect(container.querySelector('.elysion-connector-preview')).toBeNull());
  });

  it('selects the new connector', async () => {
    const { container, right, scene } = await prepare();

    fireEvent.pointerDown(right, pointer([272, 150]));
    fireEvent.pointerMove(right, pointer([580, 350]));
    fireEvent.pointerUp(right, pointer([580, 350], 0));

    // A selected arrow is not a shape: the points of the shapes go away.
    await waitFor(() => expect(points(container)).toHaveLength(0));
    // Let Excalidraw finish with the new arrow before the test unmounts the canvas.
    await waitFor(async () => expect((await scene()).some((e) => e.type === 'arrow')).toBe(true));
  });

  it('does nothing when released on the source itself, or after a click that went nowhere', async () => {
    const { right, scene } = await prepare();

    fireEvent.pointerDown(right, pointer([272, 150]));
    fireEvent.pointerMove(right, pointer([180, 150]));
    fireEvent.pointerUp(right, pointer([180, 150], 0));
    fireEvent.pointerDown(right, pointer([272, 150]));
    fireEvent.pointerUp(right, pointer([272, 150], 0)); // a click on the circle
    fireEvent.pointerDown(right, pointer([272, 150]));
    fireEvent.pointerMove(right, pointer([276, 152]));
    fireEvent.pointerUp(right, pointer([276, 152], 0)); // a few pixels: not a drag

    expect((await scene()).filter((e) => e.type === 'arrow')).toHaveLength(0);
    expect((await scene()).filter((e) => e.type === 'rectangle')).toHaveLength(2);
  });

  it('shows the circles of the shape it would end on, the one it would end at marked', async () => {
    const { container, right } = await prepare();
    const targets = () => [...container.querySelectorAll('[data-target="true"]')];

    fireEvent.pointerDown(right, pointer([272, 150]));
    fireEvent.pointerMove(right, pointer([600, 350])); // over the middle of the other rectangle

    await waitFor(() => expect(targets()).toHaveLength(4));
    const active = container.querySelectorAll('[data-active="true"]');
    expect(active).toHaveLength(1);
    expect((active[0] as HTMLElement).dataset['connectionPoint']).toMatch(/:left$/); // the side facing the source

    fireEvent.pointerMove(right, pointer([590, 301 - 0.5])); // near its top circle: snaps to it
    await waitFor(() =>
      expect(
        (container.querySelector('[data-active="true"]') as HTMLElement).dataset['connectionPoint'],
      ).toMatch(/:top$/),
    );

    fireEvent.pointerMove(right, pointer([900, 700])); // away from everything
    await waitFor(() => expect(targets()).toHaveLength(0));
    fireEvent.pointerMove(right, pointer([180, 150]));
    fireEvent.pointerUp(right, pointer([180, 150], 0)); // back on the source: cancelled
  });

  it('ends on the circle the pointer is close to', async () => {
    const { right, scene } = await prepare();

    fireEvent.pointerDown(right, pointer([272, 150]));
    fireEvent.pointerMove(right, pointer([580, 292])); // 8 px above the top of the other rectangle: its top circle
    fireEvent.pointerUp(right, pointer([580, 292], 0));

    await waitFor(async () => expect((await scene()).some((e) => e.type === 'arrow')).toBe(true));
    const arrow = (await scene()).find((e) => e.type === 'arrow') as unknown as {
      endBinding: { fixedPoint: [number, number] };
    };
    expect(arrow.endBinding.fixedPoint[1]).toBeCloseTo(0, 1); // attached to the top side
  });

  it('makes a new sticky note connected to the source when released on empty canvas, in one undo step', async () => {
    const { container, right, scene } = await prepare();

    fireEvent.pointerDown(right, pointer([272, 150]));
    fireEvent.pointerMove(right, pointer([400, 160]));
    fireEvent.pointerMove(right, pointer([420, 160]));
    fireEvent.pointerUp(right, pointer([420, 160], 0));

    await waitFor(async () => expect((await scene()).some((e) => e.type === 'arrow')).toBe(true));
    const elements = (await scene()).filter((e) => !e.isDeleted);
    const note = elements.filter((e) => e.type === 'rectangle').at(-1)!; // the third rectangle
    const arrow = elements.find((e) => e.type === 'arrow')!;
    expect(elements.filter((e) => e.type === 'rectangle')).toHaveLength(3);
    expect(elements.some((e) => e.type === 'text')).toBe(true); // the note's text
    expect(arrow.endBinding?.elementId).toBe(note.id);
    expect(arrow.elbowed).toBe(true);

    // The note is in edit mode (Excalidraw's text editor is open): leave it before the test ends.
    await waitFor(() =>
      expect(container.querySelector('textarea.excalidraw-wysiwyg')).toBeTruthy(),
    );
    fireEvent.keyDown(container.querySelector('textarea.excalidraw-wysiwyg')!, { key: 'Escape' });
    await waitFor(() => expect(container.querySelector('textarea.excalidraw-wysiwyg')).toBeNull());

    fireEvent.click(
      within(screen.getByRole('toolbar', { name: 'Canvas tools' })).getByRole('button', {
        name: 'Undo',
      }),
    );
    await waitFor(async () =>
      expect((await scene()).filter((e) => !e.isDeleted && e.type !== 'rectangle')).toHaveLength(0),
    );
    expect((await scene()).filter((e) => !e.isDeleted && e.type === 'rectangle')).toHaveLength(2);
  });

  it('is cancelled by Escape', async () => {
    const { container, right, scene } = await prepare();

    fireEvent.pointerDown(right, pointer([272, 150]));
    fireEvent.pointerMove(right, pointer([580, 350]));
    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => expect(container.querySelector('.elysion-connector-preview')).toBeNull());
    fireEvent.pointerUp(right, pointer([580, 350], 0));

    expect((await scene()).filter((e) => e.type === 'arrow')).toHaveLength(0);
  });

  it('is one undo step', async () => {
    const { right, scene } = await prepare();
    fireEvent.pointerDown(right, pointer([272, 150]));
    fireEvent.pointerMove(right, pointer([580, 350]));
    fireEvent.pointerUp(right, pointer([580, 350], 0));
    await waitFor(async () => expect((await scene()).some((e) => e.type === 'arrow')).toBe(true));

    fireEvent.click(
      within(screen.getByRole('toolbar', { name: 'Canvas tools' })).getByRole('button', {
        name: 'Undo',
      }),
    );

    await waitFor(async () =>
      expect((await scene()).filter((e) => e.type === 'arrow' && !e.isDeleted)).toHaveLength(0),
    );
    expect((await scene()).filter((e) => e.type === 'rectangle')).toHaveLength(2); // the shapes stay
  });
});
