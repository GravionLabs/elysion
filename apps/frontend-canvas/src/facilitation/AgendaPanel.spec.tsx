import { act, fireEvent, render, screen, within } from '@testing-library/react';
import axe from 'axe-core';
import { useEffect, useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../i18n';
import { addItem, linkFrame, startItem, type AgendaItem } from './agenda';
import { AgendaPanel, formatSpent, type AgendaPanelProps } from './AgendaPanel';
import { started } from './timer';

const T0 = new Date(2026, 9, 31, 9, 0, 0).getTime();
const MIN = 60_000;
const ADA = { id: 'u1', name: 'Ada' };

function plan(): AgendaItem[] {
  return addItem(addItem([], 'a', 'Intro', 5), 'b', 'Ideas', 20);
}

/** The panel with the list in a state of its own, as the canvas keeps it in the document. */
function setup(props: Partial<AgendaPanelProps> = {}, initial: AgendaItem[] = plan()) {
  const onStart = vi.fn();
  const onNext = vi.fn();
  const onClose = vi.fn();
  let ids = 0;
  const latest: { items: AgendaItem[] } = { items: initial };
  function Harness() {
    const [items, setItems] = useState(initial);
    useEffect(() => {
      latest.items = items;
    }, [items]);
    return (
      <AgendaPanel
        items={items}
        timer={null}
        readOnly={false}
        frames={new Map([['f1', 'Brainstorm']])}
        selectedFrame={null}
        onChange={(change) => setItems((list) => change(list))}
        onStart={onStart}
        onNext={onNext}
        onClose={onClose}
        now={() => T0}
        newId={() => `new-${++ids}`}
        {...props}
      />
    );
  }
  const view = render(
    <I18nProvider locale="en">
      <Harness />
    </I18nProvider>,
  );
  return { onStart, onNext, onClose, latest, ...view };
}

const titles = () =>
  screen
    .getAllByRole('textbox', { name: /^Title of item/ })
    .map((box) => (box as HTMLInputElement).value);

describe('AgendaPanel', () => {
  it('adds an item with its minutes, and the total and the planned end follow', () => {
    setup({}, []);
    expect(screen.getByText(/No items yet/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Add' })).toHaveProperty('disabled', true);

    fireEvent.change(screen.getByRole('textbox', { name: 'New item' }), {
      target: { value: 'Check-in' },
    });
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Minutes' }), {
      target: { value: '15' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));

    expect(titles()).toEqual(['Check-in']);
    expect(screen.getByRole('textbox', { name: 'New item' })).toHaveProperty('value', '');
    const end = new Date(T0 + 15 * MIN).toLocaleTimeString('en', {
      hour: '2-digit',
      minute: '2-digit',
    });
    expect(screen.getByText(`Total: 15 min · Planned end: ${end}`)).toBeTruthy();
  });

  it('renames an item and sets its minutes when the field is left', () => {
    const { latest } = setup();
    const title = screen.getByRole('textbox', { name: 'Title of item 2' });
    fireEvent.change(title, { target: { value: 'Brainstorm' } });
    fireEvent.blur(title);
    const minutes = screen.getByRole('spinbutton', { name: 'Planned minutes for Intro' });
    fireEvent.change(minutes, { target: { value: '8' } });
    fireEvent.keyDown(minutes, { key: 'Enter' });
    fireEvent.blur(minutes);

    expect(latest.items.map((item) => [item.title, item.durationMin])).toEqual([
      ['Intro', 8],
      ['Brainstorm', 20],
    ]);
    expect(screen.getByText(/^Total: 28 min/)).toBeTruthy();
  });

  it('keeps the old title when the field is emptied', () => {
    const { latest } = setup();
    const title = screen.getByRole('textbox', { name: 'Title of item 1' });
    fireEvent.change(title, { target: { value: '   ' } });
    fireEvent.blur(title);
    expect(latest.items[0].title).toBe('Intro');
  });

  it('reorders with the buttons and with Alt+Arrow keys, keeping the focus on the moved item', async () => {
    setup();
    fireEvent.click(screen.getByRole('button', { name: 'Move Ideas up' }));
    expect(titles()).toEqual(['Ideas', 'Intro']);
    expect(screen.getByRole('button', { name: 'Move Ideas up' })).toHaveProperty('disabled', true);

    const down = screen.getByRole('button', { name: 'Move Ideas down' });
    down.focus();
    fireEvent.keyDown(down, { key: 'ArrowDown', altKey: true });
    expect(titles()).toEqual(['Intro', 'Ideas']);
    await act(() => Promise.resolve());
    // Ideas is last now: its Move down is disabled, so the focus is on its Move up.
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Move Ideas up' }));

    // Without Alt an arrow key does nothing to the order.
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Title of item 1' }), {
      key: 'ArrowDown',
    });
    expect(titles()).toEqual(['Intro', 'Ideas']);
  });

  it('reorders by dragging an item onto another', () => {
    setup();
    const [first, second] = screen.getAllByRole('listitem');
    const data = { setData: vi.fn(), effectAllowed: '' };
    fireEvent.dragStart(second, { dataTransfer: data });
    fireEvent.dragOver(first, { dataTransfer: data });
    fireEvent.drop(first, { dataTransfer: data });
    expect(titles()).toEqual(['Ideas', 'Intro']);
  });

  it('deletes an item', () => {
    const { latest } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Delete Intro' }));
    expect(latest.items.map((item) => item.id)).toEqual(['b']);
  });

  it('offers "Link to selected frame" only while a frame is selected', () => {
    setup();
    expect(screen.getByRole('button', { name: 'Link Intro to the selected frame' })).toHaveProperty(
      'disabled',
      true,
    );
  });

  it('links the selected frame, names it, and unlinks it', () => {
    const { latest } = setup({ selectedFrame: { id: 'f1', name: 'Brainstorm' } });
    fireEvent.click(screen.getByRole('button', { name: 'Link Intro to the selected frame' }));
    expect(latest.items[0].frameId).toBe('f1');
    expect(screen.getByText('Frame: Brainstorm')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Unlink the frame from Intro' }));
    expect(latest.items[0].frameId).toBeNull();
  });

  it('says that a linked frame was removed from the board', () => {
    setup({}, linkFrame(plan(), 'a', 'gone'));
    expect(screen.getByText('Frame: removed from the board')).toBeTruthy();
  });

  it('starts an item and goes on with Next', () => {
    const { onStart, onNext } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Start Ideas' }));
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(onStart).toHaveBeenCalledWith('b');
    expect(onNext).toHaveBeenCalledOnce();
  });

  it('highlights and announces the current item, and shows the time spent next to the planned one', () => {
    setup({ now: () => T0 + 3 * MIN + 7000 }, startItem(plan(), 'a', T0));
    const current = screen.getAllByRole('listitem')[0];
    expect(current.getAttribute('aria-current')).toBe('step');
    expect(screen.getAllByRole('listitem')[1].getAttribute('aria-current')).toBeNull();
    expect(screen.getByRole('status').textContent).toBe('Now: Intro');
    expect(within(current).getByText('3:07 spent')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Start Intro' })).toHaveProperty('disabled', true);
  });

  it('says when the time is up and does not move on by itself', () => {
    const { onNext } = setup(
      { timer: started(5 * MIN, ADA, T0), now: () => T0 + 6 * MIN },
      startItem(plan(), 'a', T0),
    );
    expect(screen.getByRole('status').textContent).toBe(
      'Time is up for Intro. Press Next when you are ready.',
    );
    expect(onNext).not.toHaveBeenCalled();
    expect(screen.getAllByRole('listitem')[0].getAttribute('aria-current')).toBe('step');
  });

  it('follows an extended timer, and still says the time is up once the ended timer was cleared', () => {
    const extended = { ...started(5 * MIN, ADA, T0), durationMs: 8 * MIN };
    const first = setup({ timer: extended, now: () => T0 + 6 * MIN }, startItem(plan(), 'a', T0));
    expect(screen.getByRole('status').textContent).toBe('Now: Intro');
    first.unmount();

    setup({ timer: null, now: () => T0 + 6 * MIN }, startItem(plan(), 'a', T0));
    expect(screen.getByRole('status').textContent).toBe(
      'Time is up for Intro. Press Next when you are ready.',
    );
  });

  it('counts the time on while an item runs', () => {
    vi.useFakeTimers();
    try {
      let clock = T0 + MIN;
      setup({ now: () => clock }, startItem(plan(), 'a', T0));
      expect(screen.getByText('1:00 spent')).toBeTruthy();
      clock += 5000;
      act(() => vi.advanceTimersByTime(1000));
      expect(screen.getByText('1:05 spent')).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });

  it('shows a viewer the agenda and the current item without a control to change it', () => {
    setup({ readOnly: true }, startItem(plan(), 'b', T0));
    expect(screen.getByText('Intro')).toBeTruthy();
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.queryByRole('button', { name: /^Start/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Next' })).toBeNull();
    expect(
      screen.getAllByRole('button').map((button) => button.getAttribute('aria-label')),
    ).toEqual(['Close the agenda']);
    expect(screen.getAllByRole('listitem')[1].getAttribute('aria-current')).toBe('step');
  });

  it('tells a viewer that there is no agenda', () => {
    setup({ readOnly: true }, []);
    expect(screen.getByText('This board has no agenda.')).toBeTruthy();
  });

  it('closes with Esc, and the focus goes in when it opens', () => {
    const { onClose } = setup();
    expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'New item' }));
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'New item' }), { key: 'Escape' });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('passes axe (WCAG 2.1 A and AA) for an editor and for a viewer', async () => {
    const editor = setup(
      { selectedFrame: { id: 'f1', name: 'Brainstorm' } },
      linkFrame(startItem(plan(), 'a', T0), 'a', 'f1'),
    );
    const viewer = render(
      <I18nProvider locale="en">
        <AgendaPanel
          items={startItem(plan(), 'a', T0)}
          timer={null}
          readOnly={true}
          frames={new Map()}
          selectedFrame={null}
          onChange={() => undefined}
          onStart={() => undefined}
          onNext={() => undefined}
          onClose={() => undefined}
          now={() => T0}
        />
      </I18nProvider>,
    );

    for (const container of [editor.container, viewer.container]) {
      // jsdom has no layout, so the color checks cannot run here.
      const results = await act(() =>
        axe.run(container, {
          runOnly: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'],
          rules: { 'color-contrast': { enabled: false }, region: { enabled: false } },
        }),
      );
      expect(
        results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.html).join(' | ')}`),
      ).toEqual([]);
    }
  });

  it('is drawn in German', () => {
    render(
      <I18nProvider locale="de">
        <AgendaPanel
          items={plan()}
          timer={null}
          readOnly={false}
          frames={new Map()}
          selectedFrame={null}
          onChange={() => undefined}
          onStart={() => undefined}
          onNext={() => undefined}
          onClose={() => undefined}
          now={() => T0}
        />
      </I18nProvider>,
    );
    expect(screen.getByRole('button', { name: 'Weiter' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Intro starten' })).toBeTruthy();
  });
});

describe('formatSpent', () => {
  it('writes minutes and seconds, and hours from an hour on', () => {
    expect(formatSpent(0)).toBe('0:00');
    expect(formatSpent(65_000)).toBe('1:05');
    expect(formatSpent(3_725_000)).toBe('1:02:05');
    expect(formatSpent(-5)).toBe('0:00');
  });
});
