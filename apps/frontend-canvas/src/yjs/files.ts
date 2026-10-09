/**
 * Where the bytes of a board's images live: the host (the Angular shell) stores them through the BFF, so the shared
 * document holds references only (#702). The id is Excalidraw's own file id, a hash of the content.
 */
export interface FileStore {
  /** Stores the file under `id`; rejects when the server refuses it (too large, a type that is not allowed, too many files). */
  put(file: Blob, id: string): Promise<void>;
  /** The file stored under `id`; rejects when it cannot be read. */
  get(id: string): Promise<Blob>;
}

/** What the shared `files` map holds per file id: no bytes, only what Excalidraw needs to know about the file. */
export interface FileReference {
  mimeType: string;
  created: number;
}

export function dataUrlToBlob(dataUrl: string): Blob {
  const comma = dataUrl.indexOf(',');
  const header = dataUrl.slice(0, comma);
  const mimeType = /^data:([^;,]+)/.exec(header)?.[1] ?? 'application/octet-stream';
  const payload = dataUrl.slice(comma + 1);
  if (!header.includes(';base64')) {
    return new Blob([decodeURIComponent(payload)], { type: mimeType });
  }
  const binary = atob(payload);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mimeType });
}

export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error('The file could not be read.'));
    reader.readAsDataURL(blob);
  });
}
