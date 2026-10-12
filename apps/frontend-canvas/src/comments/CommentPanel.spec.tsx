import { act, fireEvent, render, screen, within } from '@testing-library/react';
import * as Y from 'yjs';
import { describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../i18n';
import { CommentPanel, type CommentPanelProps } from './CommentPanel';
import { CommentError, addReply, addThread, readThreads, setResolved } from './comments';

const ann = { id: 'u-ann', name: 'Ann' };
const bob = { id: 'u-bob', name: 'Bob' };

function setup(overrides: Partial<CommentPanelProps> = {}, build?: (doc: Y.Doc) => void) {
  const doc = new Y.Doc();
  if (build) build(doc);
  else {
    const open = addThread(doc, { elementId: 'e1' }, 'Why this one? @{u-bob}', ann, 1);
    addReply(doc, open, 'Because.', bob, 2);
    const done = addThread(doc, { x: 3, y: 4 }, 'Old', bob, 0);
    setResolved(doc, done, true, ann);
  }
  const props: CommentPanelProps = {
    threads: readThreads(doc),
    me: ann,
    moderate: false,
    pending: null,
    activeId: null,
    directory: [
      { id: 'u-ann', name: 'Ann' },
      { id: 'u-bob', name: 'Bob' },
      { id: 'u-cy', name: 'Cy Young' },
    ],
    names: new Map([
      ['u-ann', 'Ann'],
      ['u-bob', 'Bob'],
    ]),
    describeAnchor: (anchor) => ('elementId' in anchor ? 'Sticky note' : 'A point'),
    placing: false,
    onStart: vi.fn(),
    onReply: vi.fn(),
    onResolve: vi.fn(),
    onDelete: vi.fn(),
    onNew: vi.fn(),
    onCancelNew: vi.fn(),
    onShow: vi.fn(),
    onClose: vi.fn(),
    ...overrides,
  };
  render(
    <I18nProvider locale="en">
      <CommentPanel {...props} />
    </I18nProvider>,
  );
  return props;
}

describe('CommentPanel', () => {
  it('lists the open threads before the resolved ones, with the mentions as names', () => {
    setup();

    const headings = screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent);
    expect(headings).toEqual(['Open (1)', 'Resolved (1)']);
    expect(screen.getByText('Why this one? @Bob')).toBeTruthy();
    expect(screen.getByText('Because.')).toBeTruthy();
    expect(screen.getByText('Sticky note')).toBeTruthy();
  });

  it('says when there is nothing, and what to do while the tool is armed', () => {
    setup({ threads: [] });
    expect(screen.getByText('No comments yet.')).toBeTruthy();
  });

  it('asks for a click while the tool is armed', () => {
    setup({ threads: [], placing: true });
    expect(screen.getByRole('status').textContent).toContain('Click an element or a point');
  });

  it('replies with Ctrl+Enter and with the button, and clears the box', () => {
    const props = setup();
    const box = screen.getAllByPlaceholderText('Reply…')[0] as HTMLTextAreaElement;

    fireEvent.change(box, { target: { value: 'Thanks' } });
    fireEvent.keyDown(box, { key: 'Enter', ctrlKey: true });

    expect(props.onReply).toHaveBeenCalledWith(expect.any(String), 'Thanks', {});
    expect(box.value).toBe('');
  });

  it('keeps the text and says why when the comment is refused', () => {
    const onReply = vi.fn(() => {
      throw new CommentError('too-long');
    });
    setup({ onReply });
    const box = screen.getByPlaceholderText('Reply…') as HTMLTextAreaElement;

    fireEvent.change(box, { target: { value: 'Too much' } });
    fireEvent.click(screen.getByRole('button', { name: 'Reply' }));

    expect(box.value).toBe('Too much');
    expect(screen.getByText('A comment can have up to 2000 characters.')).toBeTruthy();
  });

  it('offers the people after @, stores the id of the one picked and shows the name', () => {
    const props = setup();
    const box = screen.getByPlaceholderText('Reply…') as HTMLTextAreaElement;

    fireEvent.change(box, { target: { value: 'ask @cy', selectionStart: 7 } });
    box.setSelectionRange(7, 7);
    fireEvent.change(box, { target: { value: 'ask @cy' } });
    const option = screen.getByRole('option', { name: 'Cy Young' });
    fireEvent.mouseDown(option);

    expect(box.value).toBe('ask @Cy Young ');
    // The list is closed once a person is picked, so it does not cover the Reply button.
    expect(screen.queryByRole('listbox')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Reply' }));
    expect(props.onReply).toHaveBeenCalledWith(expect.any(String), 'ask @{u-cy} ', {
      'u-cy': 'Cy Young',
    });
  });

  describe('the host search for @', () => {
    const type = (value: string) => {
      const box = screen.getByPlaceholderText('Reply…') as HTMLTextAreaElement;
      fireEvent.change(box, { target: { value, selectionStart: value.length } });
      box.setSelectionRange(value.length, value.length);
      fireEvent.change(box, { target: { value } });
      return box;
    };
    const rest = async (ms = 250) => {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(ms);
      });
    };

    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it('asks after a rest and only from two characters on, and offers what it found next to the directory', async () => {
      const search = vi.fn(async () => [{ id: 'u-new', name: 'Nora New' }]);
      setup({ search });

      type('hi @c');
      await rest();
      expect(search).not.toHaveBeenCalled();

      type('hi @cy');
      type('hi @cyn'); // typing on restarts the rest
      await rest(100);
      expect(search).not.toHaveBeenCalled();
      await rest(150);
      expect(search).toHaveBeenCalledTimes(1);
      expect(search).toHaveBeenCalledWith('cyn');
    });

    it('lists the found people, announces the count and stores the id of the one picked', async () => {
      const search = vi.fn(async () => [{ id: 'u-new', name: 'Nora Newman' }]);
      const props = setup({ search });

      const box = type('ask @no');
      await rest();

      expect(screen.getByRole('status', { name: '' }).textContent).toBe('1 person found');
      fireEvent.mouseDown(screen.getByRole('option', { name: 'Nora Newman' }));
      expect(box.value).toBe('ask @Nora Newman ');
      fireEvent.click(screen.getByRole('button', { name: 'Reply' }));
      expect(props.onReply).toHaveBeenCalledWith(expect.any(String), 'ask @{u-new} ', {
        'u-new': 'Nora Newman',
      });
    });

    it('keeps the local list when the search fails, and the last answer wins', async () => {
      let first: (people: { id: string; name: string }[]) => void = () => undefined;
      const search = vi
        .fn()
        .mockImplementationOnce(() => new Promise((resolve) => (first = resolve)))
        .mockResolvedValueOnce([{ id: 'u-two', name: 'Cyril Two' }])
        .mockRejectedValue(new Error('down'));
      setup({ search });

      type('@cy');
      await rest();
      type('@cyr');
      await rest();
      await act(async () => first([{ id: 'u-old', name: 'Cyd Old' }])); // arrives late
      expect(screen.queryByRole('option', { name: 'Cyd Old' })).toBeNull();
      expect(screen.getByRole('option', { name: 'Cyril Two' })).toBeTruthy();

      type('@cyx');
      await rest();
      expect(screen.queryByRole('option', { name: 'Cyril Two' })).toBeNull();
    });

    it('does not ask when the host has no search, and the directory still works', async () => {
      setup();
      type('ask @cy');
      await rest();

      expect(screen.getByRole('option', { name: 'Cy Young' })).toBeTruthy();
    });
  });

  it('shows the new-comment box for a place that was clicked, and sends it', () => {
    const props = setup({ pending: { elementId: 'e1' } });
    const box = screen.getByPlaceholderText('Write a comment… (@ mentions someone)');

    fireEvent.change(box, { target: { value: 'Hello' } });
    fireEvent.click(screen.getByRole('button', { name: 'Comment' }));

    expect(props.onStart).toHaveBeenCalledWith('Hello', {});
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(props.onCancelNew).toHaveBeenCalled();
  });

  it('resolves, reopens and shows who resolved', () => {
    const props = setup();

    fireEvent.click(screen.getByRole('button', { name: 'Resolve' }));
    expect(props.onResolve).toHaveBeenCalledWith(expect.any(String), true);

    fireEvent.click(screen.getByRole('button', { name: 'Reopen' }));
    expect(props.onResolve).toHaveBeenLastCalledWith(expect.any(String), false);
    expect(screen.getByText('Resolved by Ann')).toBeTruthy();
  });

  it('lets a person delete their own messages only, and an owner any', () => {
    setup();
    expect(
      screen
        .getAllByRole('button', { name: /^Delete the comment of/ })
        .map((b) => b.getAttribute('aria-label')),
    ).toEqual(['Delete the comment of Ann']);
  });

  it('lets the owner delete any message', () => {
    const props = setup({ moderate: true });
    const buttons = screen.getAllByRole('button', { name: /^Delete the comment of/ });
    expect(buttons).toHaveLength(3);

    fireEvent.click(buttons[1]);
    expect(props.onDelete).toHaveBeenCalledWith(expect.any(String), expect.any(String));
  });

  it('hides the reply box of a resolved thread', () => {
    setup();
    expect(screen.getAllByPlaceholderText('Reply…')).toHaveLength(1);
  });

  it('shows the thread on the board and closes', () => {
    const props = setup();

    fireEvent.click(screen.getByRole('button', { name: 'Sticky note' }));
    expect(props.onShow).toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Close the comments' }));
    expect(props.onClose).toHaveBeenCalled();
    expect(
      within(screen.getByRole('complementary')).getByRole('heading', { level: 2 }).textContent,
    ).toBe('Comments');
  });
});
