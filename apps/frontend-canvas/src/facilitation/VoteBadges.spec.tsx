import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CanvasApp, type CanvasControls } from '../CanvasApp';
import { excalidrawReady } from '../test-utils';
import { CLICK_TOLERANCE, hintText, topRightCorner } from './VoteBadges';
import type { VotingView } from './voting';

type Point = [number, number];

const pointer = (point: Point, buttons = 1) => ({
  clientX: point[0],
  clientY: point[1],
  pointerId: 1,
  pointerType: 'mouse',
  button: 0,
  buttons,
});

/** A press and a release on the canvas: a click when they are at the same place, else a drag. */
function press(canvas: Element, from: Point, to: Point = from) {
  fireEvent.pointerDown(canvas, pointer(from));
  if (to !== from) fireEvent.pointerMove(canvas, pointer(to));
  fireEvent.pointerUp(canvas, pointer(to, 0));
}

/** A rectangle at (100,100)-(260,200) and the canvas to drive the voting on it. */
async function setup(options: { readOnly?: boolean; userId?: string } = {}) {
  const onControls = vi.fn();
  const onVotingChange = vi.fn();
  const boardId = `vote-${crypto.randomUUID()}`;
  const app = (readOnly?: boolean) => (
    <CanvasApp
      boardId={boardId}
      userId={options.userId ?? 'kc-1'}
      onControls={onControls}
      onVotingChange={onVotingChange}
      readOnly={readOnly}
    />
  );
  const { container, rerender } = render(app(options.readOnly));
  await excalidrawReady(container);
  const controls: CanvasControls = onControls.mock.calls[0][0];
  const canvas = container.querySelector('canvas.interactive') as Element;
  fireEvent.click(screen.getByRole('button', { name: 'Rectangle' }));
  press(canvas, [100, 100], [260, 200]);
  fireEvent.click(screen.getByRole('button', { name: 'Selection' }));
  const view = () => onVotingChange.mock.calls.at(-1)?.[0] as VotingView | null | undefined;
  const dots = () => container.querySelectorAll('[data-vote-dot]');
  const hint = () => container.querySelector('.elysion-vote-hint')?.textContent ?? null;
  const open = async (votes = 3) => {
    await controls.startVoting({ name: 'Pick', votesPerPerson: votes });
    await waitFor(() => expect(view()?.status).toBe('open'));
  };
  /** The same canvas, now for a viewer: what a person who may not write sees of a voting that is open. */
  const becomeViewer = () => rerender(app(true));
  return { container, controls, canvas, onVotingChange, view, dots, hint, open, becomeViewer };
}

describe('dot voting on the canvas', () => {
  it('casts a vote with a click on an element and shows the own dot', async () => {
    const { canvas, open, dots, view } = await setup();
    await open();

    press(canvas, [180, 150]);

    await waitFor(() => expect(dots()).toHaveLength(1));
    expect(view()?.myVotes).toBe(1);
  });

  it('adds one dot per click, up to the limit, and says what is left', async () => {
    const { canvas, open, dots, hint, view } = await setup();
    await open(2);
    expect(hint()).toBe('Voting: 2 of 2 votes left (click an element to vote)');

    press(canvas, [180, 150]);
    await waitFor(() => expect(dots()).toHaveLength(1));
    expect(hint()).toBe('Voting: 1 of 2 votes left (click an element to vote)');
    press(canvas, [180, 150]);
    await waitFor(() => expect(dots()).toHaveLength(2));
    expect(hint()).toContain('no votes left');

    press(canvas, [180, 150]); // past the limit
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(dots()).toHaveLength(2);
    expect(view()?.myVotes).toBe(2);
  });

  it('takes a vote back with a click on one of the own dots', async () => {
    const { container, canvas, open, dots, view } = await setup();
    await open();
    press(canvas, [180, 150]);
    await waitFor(() => expect(dots()).toHaveLength(1));

    fireEvent.click(container.querySelector('[data-vote-dot]') as Element);

    await waitFor(() => expect(dots()).toHaveLength(0));
    expect(view()?.myVotes).toBe(0);
  });

  it('does not vote for a drag, for a click on empty canvas, or with another tool', async () => {
    const { canvas, open, dots, view } = await setup();
    await open();

    press(canvas, [180, 150], [180 + CLICK_TOLERANCE + 20, 150]); // a drag: the element moves, nothing is voted
    press(canvas, [600, 500]); // empty canvas
    fireEvent.click(screen.getByRole('button', { name: 'Rectangle' }));
    press(canvas, [180, 150]); // the rectangle tool draws, it does not vote
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(dots()).toHaveLength(0);
    expect(view()?.myVotes).toBe(0);
  });

  it('does nothing without an open voting', async () => {
    const { canvas, dots, hint } = await setup();

    press(canvas, [180, 150]);
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(dots()).toHaveLength(0);
    expect(hint()).toBeNull();
  });

  it('gives a viewer no hint, no way to vote and no way to take a vote back, but shows what is there', async () => {
    const { container, canvas, open, dots, hint, view, becomeViewer } = await setup();
    await open();
    press(canvas, [180, 150]);
    await waitFor(() => expect(dots()).toHaveLength(1));

    becomeViewer();
    await waitFor(() => expect(hint()).toBeNull());
    press(canvas, [180, 150]);
    fireEvent.click(container.querySelector('[data-vote-dot]') as Element);
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(view()?.myVotes).toBe(1); // neither a vote nor a retract went through
    expect((container.querySelector('[data-vote-dot]') as HTMLButtonElement).disabled).toBe(true);
  });

  it('shows count badges on the voted elements once closed, and no dots or hint', async () => {
    const { container, controls, canvas, open, dots, hint, view } = await setup();
    await open();
    press(canvas, [180, 150]);
    press(canvas, [180, 150]);
    await waitFor(() => expect(dots()).toHaveLength(2));

    await controls.endVoting();

    await waitFor(() => expect(view()?.status).toBe('closed'));
    const badge = container.querySelector('[data-vote-count]');
    expect(badge?.textContent).toBe('2');
    expect(dots()).toHaveLength(0);
    expect(hint()).toBeNull();
    expect(container.querySelector('.elysion-vote-badges')?.getAttribute('aria-hidden')).toBe(
      'true',
    );
  });

  it('keeps votes after the result is shown: a click no longer votes, and clearing removes the badges', async () => {
    const { container, controls, canvas, open, view } = await setup();
    await open();
    press(canvas, [180, 150]);
    await waitFor(() => expect(view()?.myVotes).toBe(1));
    await controls.endVoting();
    await waitFor(() => expect(container.querySelector('[data-vote-count]')).toBeTruthy());

    press(canvas, [180, 150]);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(container.querySelector('[data-vote-count]')?.textContent).toBe('1');

    await controls.clearVotingResults();
    await waitFor(() => expect(container.querySelector('[data-vote-count]')).toBeNull());
  });

  it('puts none of it in an export of the board', async () => {
    const { controls, canvas, open, dots } = await setup();
    await open();
    press(canvas, [180, 150]);
    await waitFor(() => expect(dots()).toHaveLength(1));

    const file = JSON.parse(await ((await controls.exportBoard('excalidraw')) as Blob).text());
    const svg = await ((await controls.exportBoard('svg')) as Blob).text();

    expect(JSON.stringify(file)).not.toMatch(/vote|voting/i);
    expect(svg).not.toMatch(/elysion-vote/);
  });

  it('keeps the vote after the person is told apart by a user id that arrives later, per tab before', async () => {
    const { open, view } = await setup({ userId: 'kc-1' });
    await open();

    expect(view()?.startedBy.id).toBe('kc-1');
  });
});

describe('the corner of an element', () => {
  const element = (angle: number) =>
    ({ x: 100, y: 100, width: 40, height: 20, angle }) as Parameters<typeof topRightCorner>[0];

  it('is the top-right corner of a plain element', () => {
    expect(topRightCorner(element(0))).toEqual({ x: 140, y: 100 });
  });

  it('turns with the element', () => {
    const turned = topRightCorner(element(Math.PI / 2));
    expect(turned.x).toBeCloseTo(130, 5);
    expect(turned.y).toBeCloseTo(130, 5);
  });
});

describe('the hint', () => {
  it('counts what is left, and says what to do when nothing is', () => {
    expect(hintText(3, 5)).toBe('Voting: 3 of 5 votes left (click an element to vote)');
    expect(hintText(0, 5)).toContain('no votes left');
  });
});
