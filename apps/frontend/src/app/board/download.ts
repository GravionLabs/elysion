export type ExportFormat = 'png' | 'svg' | 'excalidraw' | 'pdf';

const EXTENSION: Record<ExportFormat, string> = {
  png: 'png',
  svg: 'svg',
  excalidraw: 'excalidraw',
  pdf: 'pdf',
};

/** A file name from the board's name (or id): letters, digits and `._-`, never empty. */
export function exportFilename(
  name: string | null,
  boardId: string,
  format: ExportFormat,
  selectionOnly: boolean,
): string {
  const base =
    (name ?? boardId)
      .trim()
      .replace(/[^\p{L}\p{N}._-]+/gu, '-')
      .replace(/^[-.]+|-+$/g, '')
      .slice(0, 60) || 'board';
  return `${base}${selectionOnly ? '-selection' : ''}.${EXTENSION[format]}`;
}

/** Hands a blob to the browser as a download, through a temporary link. */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  // The click has started the download; the URL is not needed after that.
  setTimeout(() => URL.revokeObjectURL(url));
}
