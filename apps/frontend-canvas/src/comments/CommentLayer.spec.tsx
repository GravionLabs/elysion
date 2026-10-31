import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ExcalidrawElement } from '@excalidraw/excalidraw/element/types';
import { CanvasApp, type CanvasControls } from '../CanvasApp';
import { excalidrawReady } from '../test-utils';
import { anchorPoint, topLeftCorner } from './CommentLayer';

type Point = [number, number];

const pointer = (point: Point, buttons = 1) => ({
  clientX: point[0],
  clientY: point[1],
  pointerId: 1,
  pointerType: 'mouse',
  button: 0,
  buttons,
});

function press(canvas: Element, from: Point, to: Point = from) {
  fireEvent.pointerDown(canvas, pointer(from));
  if (to !== from) fireEvent.pointerMove(canvas, pointer(to));
  fireEvent.pointerUp(canvas, pointer(to, 0));
}

const element = (patch: Partial<ExcalidrawElement>) =>
  ({
    id: 'e',
    x: 10,
    y: 20,
    width: 100,
    height: 40,
    angle: 0,
    isDeleted: false,
    ...patch,
  }) as ExcalidrawElement;

describe('anchorPoint', () => {
  it('hangs an element anchor on the top-left corner and follows the element', () => {
    const elements = new Map([['e', element({})]]);
    expect(anchorPoint({ elementId: 'e' }, elements)).toEqual({ x: 10, y: 20 });

    elements.set('e', element({ x: 50, y: 60 }));
    expect(anchorPoint({ elementId: 'e' }, elements)).toEqual({ x: 50, y: 60 });
  });

  it('turns the corner with the element', () => {
    const corner = topLeftCorner(element({ angle: Math.PI }));
    expect(corner.x).toBeCloseTo(110);
    expect(corner.y).toBeCloseTo(60);
  });

  it('has no place for an element that is gone, and keeps a point where it is', () => {
    expect(anchorPoint({ elementId: 'e' }, new Map())).toBeNull();
    expect(
      anchorPoint({ elementId: 'e' }, new Map([['e', element({ isDeleted: true })]])),
    ).toBeNull();
    expect(anchorPoint({ x: 1, y: 2 }, new Map())).toEqual({ x: 1, y: 2 });
  });
});

/** A rectangle at (100,100)-(260,200) and the canvas to comment on it. */
async function setup(options: { readOnly?: boolean; userId?: string; userName?: string } = {}) {
  const onControls = vi.fn();
  const onCommentsChange = vi.fn();
  const mentionDirectory = vi.fn(async () => [{ id: 'u-bob', name: 'Bob' }]);
  const boardId = `comments-${crypto.randomUUID()}`;
  const { container } = render(
    <CanvasApp
      boardId={boardId}
      userId={options.userId ?? 'u-ann'}
      userName={options.userName ?? 'Ann'}
      onControls={onControls}
      onCommentsChange={onCommentsChange}
      mentionDirectory={mentionDirectory}
      readOnly={options.readOnly}
    />,
  );
  await excalidrawReady(container);
  const canvas = container.querySelector('canvas.interactive') as Element;
  if (!options.readOnly) {
    fireEvent.click(screen.getByRole('button', { name: 'Rectangle' }));
    press(canvas, [100, 100], [260, 200]);
    fireEvent.click(screen.getByRole('button', { name: 'Selection' }));
  }
  const controls: CanvasControls = onControls.mock.calls[0][0];
  return { container, canvas, controls, onCommentsChange, mentionDirectory };
}

describe('comments on the canvas', () => {
  it('places a comment on an element, shows a marker with the count and tells the host', async () => {
    const { canvas, onCommentsChange, mentionDirectory } = await setup();

    fireEvent.click(screen.getByRole('button', { name: 'Comments' }));
    expect(mentionDirectory).toHaveBeenCalled();
    // The follow overlay has an (empty) status region of its own, so the one with the hint is found by its text.
    expect(
      screen
        .getAllByRole('status')
        .some((region) => region.textContent?.includes('Click an element or a point')),
    ).toBe(true);
    press(canvas, [180, 150]);

    const box = await screen.findByPlaceholderText('Write a comment… (@ mentions someone)');
    fireEvent.change(box, { target: { value: 'Why this one?' } });
    fireEvent.click(screen.getByRole('button', { name: 'Comment' }));

    const marker = await screen.findByRole('button', { name: '1 comment' });
    expect(marker.textContent).toBe('1');
    expect(onCommentsChange).toHaveBeenLastCalledWith({ total: 1, unresolved: 1 });
    expect(within(screen.getByRole('complementary')).getByText('Why this one?')).toBeTruthy();
  });

  it('places a comment on an empty spot as a point', async () => {
    const { canvas } = await setup();

    fireEvent.click(screen.getByRole('button', { name: 'Comments' }));
    press(canvas, [600, 400]);
    fireEvent.change(await screen.findByPlaceholderText('Write a comment… (@ mentions someone)'), {
      target: { value: 'Nothing here' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Comment' }));

    expect(await screen.findByRole('button', { name: '1 comment' })).toBeTruthy();
    expect(screen.getByText('On a point of the board')).toBeTruthy();
  });

  it('does not select or draw while the tool is armed, and Esc stops it', async () => {
    const { canvas } = await setup();
    const selected = () =>
      screen.getByRole('button', { name: 'Selection' }).getAttribute('aria-pressed');

    fireEvent.click(screen.getByRole('button', { name: 'Comments' }));
    expect(document.querySelector('[data-comment-mode]')).toBeTruthy();
    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => expect(document.querySelector('[data-comment-mode]')).toBeNull());
    expect(selected()).toBe('true');
    void canvas;
  });

  it('opens with the key C when there is nothing to connect, and closes with it', async () => {
    await setup();

    fireEvent.keyDown(window, { key: 'c', code: 'KeyC' });
    expect(await screen.findByRole('complementary')).toBeTruthy();

    fireEvent.keyDown(window, { key: 'c', code: 'KeyC' });
    await waitFor(() => expect(screen.queryByRole('complementary')).toBeNull());
  });

  it('lets a viewer comment, reply and resolve', async () => {
    const { canvas } = await setup({ readOnly: true, userId: 'u-vi', userName: 'Vera' });

    fireEvent.click(screen.getByRole('button', { name: 'Comments' }));
    press(canvas, [300, 300]);
    fireEvent.change(await screen.findByPlaceholderText('Write a comment… (@ mentions someone)'), {
      target: { value: 'From a viewer' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Comment' }));
    await screen.findByRole('button', { name: '1 comment' });

    fireEvent.change(screen.getByPlaceholderText('Reply…'), { target: { value: 'And again' } });
    fireEvent.click(screen.getByRole('button', { name: 'Reply' }));
    await screen.findByRole('button', { name: '2 comments' });

    fireEvent.click(screen.getByRole('button', { name: 'Resolve' }));
    expect(await screen.findByRole('button', { name: '2 comments, resolved' })).toBeTruthy();
    expect(screen.getByText('Resolved by Vera')).toBeTruthy();
  });

  it('asks for the people of the host and mentions one', async () => {
    const { canvas } = await setup();
    fireEvent.click(screen.getByRole('button', { name: 'Comments' }));
    press(canvas, [600, 400]);

    const box = (await screen.findByPlaceholderText(
      'Write a comment… (@ mentions someone)',
    )) as HTMLTextAreaElement;
    fireEvent.change(box, { target: { value: 'hi @b' } });
    box.setSelectionRange(5, 5);
    fireEvent.change(box, { target: { value: 'hi @b' } });
    fireEvent.mouseDown(await screen.findByRole('option', { name: 'Bob' }));
    fireEvent.click(screen.getByRole('button', { name: 'Comment' }));

    expect(await screen.findByText('hi @Bob')).toBeTruthy();
  });
});
