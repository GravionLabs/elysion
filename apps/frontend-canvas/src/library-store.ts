import type { LibraryItems } from '@excalidraw/excalidraw/types';

/**
 * The user's own Excalidraw library (#770): it lives in this browser's local storage, for every board (a library is a
 * person's tools, not the board's content, so it is not part of the document), and the canvas takes a library up when the
 * user comes back from the library site ("Browse libraries") with `#addLibrary=<url>&token=<id>` in the address.
 *
 * Excalidraw has a hook for this (`useHandleLibrary`), but it cleans the address with `history.replaceState(…, '#…')`, which a
 * page with `<base href="/">` (the Angular shell) resolves against the root: the board's path is gone and a reload opens the
 * board list. So the address is read and cleaned here.
 */
export const LIBRARY_STORAGE_KEY = 'elysion:library';

export interface LibraryStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function browserStorage(): LibraryStorage | null {
  try {
    return window.localStorage;
  } catch {
    return null; // blocked or not there: the library then lasts as long as the page
  }
}

export function libraryAdapter(storage: LibraryStorage | null = browserStorage()) {
  return {
    load(): { libraryItems: LibraryItems } | null {
      try {
        const raw = storage?.getItem(LIBRARY_STORAGE_KEY);
        const parsed: unknown = raw ? JSON.parse(raw) : null;
        return Array.isArray(parsed) ? { libraryItems: parsed as LibraryItems } : null;
      } catch {
        return null;
      }
    },
    save({ libraryItems }: { libraryItems: LibraryItems }): void {
      try {
        storage?.setItem(LIBRARY_STORAGE_KEY, JSON.stringify(libraryItems));
      } catch {
        // full or blocked: the items stay in the page
      }
    },
  };
}

/** What the library site puts into the address when the user chose a library. */
export interface AddLibrary {
  url: string;
  /** The id of the Excalidraw instance that sent the user away; a different one is another tab, which asks first. */
  token: string | null;
  /** The address without `addLibrary`, for the history. */
  rest: string;
}

export function parseAddLibrary(hash: string): AddLibrary | null {
  const params = new URLSearchParams(hash.replace(/^#/, ''));
  const url = params.get('addLibrary');
  if (!url) return null;
  const token = params.get('token');
  params.delete('addLibrary');
  params.delete('token');
  const rest = params.toString();
  return { url, token, rest: rest ? `#${rest}` : '' };
}

/**
 * Only the library site of Excalidraw and its repository on GitHub: the address comes from a link anybody can send, and the
 * canvas fetches it. The same two Excalidraw itself allows, and the two origins the Content-Security-Policy opens
 * (`apps/frontend/security-headers.sh`).
 */
export function isAllowedLibraryUrl(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:' || url.username || url.password) return false;
  if (url.hostname === 'libraries.excalidraw.com') return true;
  return (
    url.hostname === 'raw.githubusercontent.com' &&
    url.pathname.startsWith('/excalidraw/excalidraw-libraries/')
  );
}
