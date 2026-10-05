import { downloadBlob, exportFilename } from './download';

describe('exportFilename', () => {
  it('uses the board name, or the id when it has none', () => {
    expect(exportFilename('Q3 planning', 'id', 'png', false)).toBe('Q3-planning.png');
    expect(exportFilename(null, 'team-retro', 'svg', false)).toBe('team-retro.svg');
  });

  it('names the four formats', () => {
    expect(exportFilename('b', 'id', 'excalidraw', false)).toBe('b.excalidraw');
    expect(exportFilename('Q3 planning', 'id', 'pdf', false)).toBe('Q3-planning.pdf');
  });

  it('marks a selection export', () => {
    expect(exportFilename('b', 'id', 'png', true)).toBe('b-selection.png');
    expect(exportFilename('Q3 planning', 'id', 'pdf', true)).toBe('Q3-planning-selection.pdf');
  });

  it('keeps letters from other languages and drops what a file system dislikes', () => {
    expect(exportFilename('Übersicht: Q3/Q4?', 'id', 'png', false)).toBe('Übersicht-Q3-Q4.png');
  });

  it('never ends up empty or hidden', () => {
    expect(exportFilename('///', 'id', 'png', false)).toBe('board.png');
    expect(exportFilename('..hidden', 'id', 'png', false)).toBe('hidden.png');
  });

  it('keeps the name within a sensible length', () => {
    expect(exportFilename('x'.repeat(200), 'id', 'png', false).length).toBeLessThanOrEqual(64);
  });
});

describe('downloadBlob', () => {
  afterEach(() => vi.restoreAllMocks());

  it('clicks a temporary link with the file name and then releases the URL', async () => {
    const create = vi.fn(() => 'blob:test');
    const revoke = vi.fn();
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: create, revokeObjectURL: revoke }));
    const clicked: HTMLAnchorElement[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      clicked.push(this);
    });

    downloadBlob(new Blob(['x']), 'board.png');

    expect(clicked).toHaveLength(1);
    expect(clicked[0].download).toBe('board.png');
    expect(clicked[0].href).toBe('blob:test');
    await new Promise((resolve) => setTimeout(resolve));
    expect(revoke).toHaveBeenCalledWith('blob:test');
  });
});
