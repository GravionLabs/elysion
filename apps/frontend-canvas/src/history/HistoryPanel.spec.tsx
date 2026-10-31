import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import axe from 'axe-core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../i18n';
import { HistoryPanel, type HistoryPanelProps } from './HistoryPanel';
import type { SnapshotApi, SnapshotInfo } from './history';

vi.mock('./snapshot-preview', () => ({
  renderSnapshotPreview: vi.fn(async (state: Uint8Array) =>
    state.length === 0 ? null : new Blob([new ArrayBuffer(state.length)], { type: 'image/png' }),
  ),
}));

const today = new Date();
today.setHours(12, 0, 0, 0);
const earlier = new Date(today);
earlier.setDate(today.getDate() - 1);
const older = new Date(today);
older.setDate(today.getDate() - 9);

const named: SnapshotInfo = {
  id: 's-named',
  kind: 'Manual',
  name: 'Before the workshop',
  author: 'Ann',
  createdAt: today.toISOString(),
  sizeBytes: 12 * 1024,
  elementCount: 4,
};
const automatic: SnapshotInfo = {
  id: 's-auto',
  kind: 'Auto',
  name: null,
  author: null,
  createdAt: earlier.toISOString(),
  sizeBytes: 900,
  elementCount: null,
};
const archived: SnapshotInfo = {
  ...named,
  id: 's-old',
  name: 'Kickoff',
  createdAt: older.toISOString(),
};

function fakeApi(overrides: Partial<SnapshotApi> = {}): SnapshotApi {
  return {
    list: vi.fn(async () => [archived, named, automatic]),
    create: vi.fn(async (name?: string) => ({
      ...named,
      id: 's-new',
      name: name ?? null,
      createdAt: new Date().toISOString(),
    })),
    rename: vi.fn(async (id: string, name: string) => ({ ...named, id, name })),
    remove: vi.fn(async () => undefined),
    document: vi.fn(async (id: string) =>
      id === 's-auto' ? new Uint8Array() : new Uint8Array([1, 2]),
    ),
    restore: vi.fn(async () => ({
      ...named,
      id: 's-before',
      kind: 'BeforeRestore' as const,
      name: 'Before restore',
      author: null,
    })),
    openAsNew: vi.fn(async () => ({ id: 'b-new', path: '/board/b-new' })),
    ...overrides,
  };
}

function setup(props: Partial<HistoryPanelProps> = {}, api: SnapshotApi = fakeApi()) {
  const onClose = vi.fn();
  const view = render(
    <I18nProvider locale="en">
      <HistoryPanel api={api} readOnly={false} canDelete={true} onClose={onClose} {...props} />
    </I18nProvider>,
  );
  return { api, onClose, ...view };
}

async function loaded() {
  await screen.findByText('Before the workshop');
}

beforeEach(() => {
  URL.createObjectURL = vi.fn((blob: Blob) => `blob:preview-${blob.size}`);
  URL.revokeObjectURL = vi.fn();
});

afterEach(() => vi.restoreAllMocks());

describe('HistoryPanel', () => {
  it('lists the versions grouped by day, newest first, with a heading per day', async () => {
    setup();
    await loaded();

    const headings = screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent);
    expect(headings[0]).toBe('Today');
    expect(headings[1]).toBe('Yesterday');
    expect(headings).toHaveLength(3);
    const todays = within(screen.getByRole('region', { name: 'Today' }));
    expect(todays.getByText('Before the workshop')).toBeTruthy();
    expect(todays.getByText(/by Ann/)).toBeTruthy();
    expect(todays.getByText(/4 elements/)).toBeTruthy();
    expect(todays.getByText(/12 KB/)).toBeTruthy();
    const yesterday = within(screen.getByRole('region', { name: 'Yesterday' }));
    expect(yesterday.getByText('Automatic version')).toBeTruthy();
  });

  it('draws a preview picture per version and says so when there is none', async () => {
    setup();
    await loaded();

    const picture = await screen.findByRole('img', { name: 'Preview of Before the workshop' });
    expect(picture.getAttribute('src')).toBe('blob:preview-2');
    await waitFor(() => expect(screen.getByText('No preview')).toBeTruthy());
  });

  it('shows the empty state and a failed load', async () => {
    const empty = setup({}, fakeApi({ list: vi.fn(async () => []) }));
    expect(await screen.findByText(/No versions yet/)).toBeTruthy();
    empty.unmount();

    setup({}, fakeApi({ list: vi.fn(async () => Promise.reject(new Error('down'))) }));
    expect((await screen.findByRole('alert')).textContent).toBe('The history could not be loaded.');
  });

  it('saves a version with a name from the prompt and puts it first', async () => {
    const { api } = setup();
    await loaded();

    fireEvent.click(screen.getByRole('button', { name: 'Save version' }));
    fireEvent.change(screen.getByLabelText('Version name (optional)'), {
      target: { value: '  Final  ' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByText('Final')).toBeTruthy();
    expect(api.create).toHaveBeenCalledWith('Final');
    expect(screen.queryByLabelText('Version name (optional)')).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Save version' }));
  });

  it('saves without a name when the prompt is left empty', async () => {
    const { api } = setup();
    await loaded();

    fireEvent.click(screen.getByRole('button', { name: 'Save version' }));
    fireEvent.submit(screen.getByLabelText('Version name (optional)').closest('form')!);

    await waitFor(() => expect(api.create).toHaveBeenCalledWith(undefined));
    expect((await screen.findAllByText('Saved version')).length).toBeGreaterThan(0);
  });

  it.each([
    [403, 'Your role on this board does not allow that.'],
    [409, /keeps 100 saved versions/],
    [503, 'The store for versions is not available right now.'],
    [undefined, 'The version could not be saved.'],
  ])('tells why saving failed (status %s)', async (status, message) => {
    setup(
      {},
      fakeApi({
        create: vi.fn(async () => Promise.reject(Object.assign(new Error('x'), { status }))),
      }),
    );
    await loaded();

    fireEvent.click(screen.getByRole('button', { name: 'Save version' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    const alert = await screen.findByRole('alert');
    if (typeof message === 'string') expect(alert.textContent).toBe(message);
    else expect(alert.textContent).toMatch(message);
  });

  it('renames a saved version, and offers it for saved versions only', async () => {
    const { api } = setup();
    await loaded();
    expect(screen.queryByRole('button', { name: 'Rename Automatic version' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Rename Before the workshop' }));
    const field = screen.getByRole('textbox', { name: 'Rename Before the workshop' });
    expect((field as HTMLInputElement).value).toBe('Before the workshop');
    fireEvent.change(field, { target: { value: 'Workshop start' } });
    fireEvent.click(screen.getByRole('button', { name: 'Rename' }));

    expect(await screen.findByText('Workshop start')).toBeTruthy();
    expect(api.rename).toHaveBeenCalledWith('s-named', 'Workshop start');
  });

  it('does not rename to an empty name', async () => {
    const { api } = setup();
    await loaded();

    fireEvent.click(screen.getByRole('button', { name: 'Rename Kickoff' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Rename Kickoff' }), {
      target: { value: '  ' },
    });

    expect((screen.getByRole('button', { name: 'Rename' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    expect(api.rename).not.toHaveBeenCalled();
  });

  it('asks before deleting, then removes the version', async () => {
    const { api } = setup();
    await loaded();

    fireEvent.click(screen.getByRole('button', { name: 'Delete Kickoff' }));
    expect(api.remove).not.toHaveBeenCalled();
    expect(screen.getByText('Delete this version? This cannot be undone.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Delete version' }));

    await waitFor(() => expect(screen.queryByText('Kickoff')).toBeNull());
    expect(api.remove).toHaveBeenCalledWith('s-old');
  });

  it('keeps the version when the question is declined or the delete is refused', async () => {
    const remove = vi.fn(async () =>
      Promise.reject(Object.assign(new Error('x'), { status: 403 })),
    );
    setup({}, fakeApi({ remove }));
    await loaded();

    fireEvent.click(screen.getByRole('button', { name: 'Delete Kickoff' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(remove).not.toHaveBeenCalled();
    expect(screen.getByText('Kickoff')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Delete Kickoff' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete version' }));
    expect((await screen.findByRole('alert')).textContent).toBe(
      'Your role on this board does not allow that.',
    );
    expect(screen.getByText('Kickoff')).toBeTruthy();
  });

  describe('restoring and opening as a new board (#847)', () => {
    it('offers Restore to owners only', async () => {
      const { unmount } = setup({ canRestore: true });
      await loaded();
      expect(screen.getByRole('button', { name: 'Restore Kickoff' })).toBeTruthy();
      unmount();

      setup({ canRestore: false });
      await loaded();
      expect(screen.queryByRole('button', { name: /^Restore/ })).toBeNull();
    });

    it('asks before restoring, restores, lists the version it kept and says so', async () => {
      const { api } = setup({ canRestore: true });
      await loaded();

      fireEvent.click(screen.getByRole('button', { name: 'Restore Kickoff' }));
      expect(api.restore).not.toHaveBeenCalled();
      expect(screen.getByText(/The current state is kept as "Before restore"\./)).toBeTruthy();
      fireEvent.click(screen.getByRole('button', { name: 'Restore version' }));

      await waitFor(() => expect(api.restore).toHaveBeenCalledWith('s-old'));
      expect(await screen.findByText(/The version is restored\./)).toBeTruthy();
      expect((await screen.findAllByText('Before restore')).length).toBeGreaterThan(0);
    });

    it('keeps the focus in the panel after a restore and after Cancel, so that Escape still closes it', async () => {
      const { onClose } = setup({ canRestore: true });
      await loaded();
      const panel = screen.getByRole('complementary');

      fireEvent.click(screen.getByRole('button', { name: 'Restore Kickoff' }));
      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
      await waitFor(() => expect(panel.contains(document.activeElement)).toBe(true));

      fireEvent.click(screen.getByRole('button', { name: 'Restore Kickoff' }));
      fireEvent.click(screen.getByRole('button', { name: 'Restore version' }));
      await screen.findByText(/The version is restored\./);
      await waitFor(() => expect(panel.contains(document.activeElement)).toBe(true));

      fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('does not restore when the question is declined, and says why a restore failed', async () => {
      const restore = vi.fn(async () =>
        Promise.reject(Object.assign(new Error('x'), { status: 503 })),
      );
      setup({ canRestore: true }, fakeApi({ restore }));
      await loaded();

      fireEvent.click(screen.getByRole('button', { name: 'Restore Kickoff' }));
      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
      expect(restore).not.toHaveBeenCalled();

      fireEvent.click(screen.getByRole('button', { name: 'Restore Kickoff' }));
      fireEvent.click(screen.getByRole('button', { name: 'Restore version' }));
      expect((await screen.findByRole('alert')).textContent).toBe(
        'The store for versions is not available right now.',
      );
      expect(screen.queryByText(/The version is restored\./)).toBeNull();
    });

    it('opens a version as a new board and hands the board to the host, also for a viewer', async () => {
      const onOpenBoard = vi.fn();
      const { api } = setup({ readOnly: true, canDelete: false, onOpenBoard });
      await loaded();

      fireEvent.click(screen.getByRole('button', { name: 'Open Kickoff as new board' }));

      await waitFor(() =>
        expect(onOpenBoard).toHaveBeenCalledWith({ id: 'b-new', path: '/board/b-new' }),
      );
      expect(api.openAsNew).toHaveBeenCalledWith('s-old');
    });

    it('tells why opening as a new board failed', async () => {
      const openAsNew = vi.fn(async () =>
        Promise.reject(Object.assign(new Error('x'), { status: 409 })),
      );
      const onOpenBoard = vi.fn();
      setup({ onOpenBoard }, fakeApi({ openAsNew }));
      await loaded();

      fireEvent.click(screen.getByRole('button', { name: 'Open Kickoff as new board' }));

      expect((await screen.findByRole('alert')).textContent).toMatch(/not possible now/);
      expect(onOpenBoard).not.toHaveBeenCalled();
    });
  });

  it('gives a viewer the list and nothing to change', async () => {
    setup({ readOnly: true, canDelete: false });
    await loaded();

    expect(screen.queryByRole('button', { name: 'Save version' })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Rename/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Delete/ })).toBeNull();
  });

  it('gives an editor Save and Rename but not Delete', async () => {
    setup({ readOnly: false, canDelete: false });
    await loaded();

    expect(screen.getByRole('button', { name: 'Save version' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Rename Kickoff' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^Delete/ })).toBeNull();
  });

  describe('with the keyboard', () => {
    it('moves the focus into the panel and gives it back on close', () => {
      const opener = document.createElement('button');
      document.body.append(opener);
      opener.focus();
      const { unmount } = setup();

      expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Save version' }));
      unmount();
      expect(document.activeElement).toBe(opener);
      opener.remove();
    });

    it('closes the form first and then the panel with Escape', async () => {
      const { onClose } = setup();
      await loaded();
      fireEvent.click(screen.getByRole('button', { name: 'Save version' }));

      fireEvent.keyDown(screen.getByLabelText('Version name (optional)'), { key: 'Escape' });
      expect(screen.queryByLabelText('Version name (optional)')).toBeNull();
      expect(onClose).not.toHaveBeenCalled();

      fireEvent.keyDown(screen.getByRole('complementary'), { key: 'Escape' });
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('submits the name with Enter', async () => {
      const { api } = setup();
      await loaded();
      fireEvent.click(screen.getByRole('button', { name: 'Save version' }));
      const field = screen.getByLabelText('Version name (optional)');
      fireEvent.change(field, { target: { value: 'Quick' } });

      fireEvent.submit(field.closest('form')!);

      await waitFor(() => expect(api.create).toHaveBeenCalledWith('Quick'));
    });

    it('closes with the close button', async () => {
      const { onClose } = setup();
      await loaded();

      fireEvent.click(screen.getByRole('button', { name: 'Close the history' }));

      expect(onClose).toHaveBeenCalled();
    });
  });

  it('passes axe (WCAG 2.1 A and AA) with its list, its prompt and a question open', async () => {
    const { container } = setup();
    await loaded();
    await screen.findByRole('img', { name: 'Preview of Before the workshop' });
    fireEvent.click(screen.getByRole('button', { name: 'Save version' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete Kickoff' }));

    // jsdom has no layout, so the color checks cannot run here; the browser test (apps/e2e) covers them.
    const results = await act(() =>
      axe.run(container, {
        runOnly: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'],
        rules: { 'color-contrast': { enabled: false }, region: { enabled: false } },
      }),
    );

    expect(
      results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.html).join(' | ')}`),
    ).toEqual([]);
  });

  it('is drawn in German', async () => {
    render(
      <I18nProvider locale="de">
        <HistoryPanel api={fakeApi()} readOnly={false} canDelete={true} onClose={vi.fn()} />
      </I18nProvider>,
    );

    expect(await screen.findByRole('heading', { name: 'Verlauf' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Version speichern' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Heute' })).toBeTruthy();
  });
});
