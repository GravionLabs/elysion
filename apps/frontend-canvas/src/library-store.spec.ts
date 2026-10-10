import { describe, expect, it } from 'vitest';
import {
  LIBRARY_STORAGE_KEY,
  isAllowedLibraryUrl,
  libraryAdapter,
  parseAddLibrary,
  type LibraryStorage,
} from './library-store';

function memory(initial?: string): LibraryStorage & { data: Map<string, string> } {
  const data = new Map<string, string>(initial ? [[LIBRARY_STORAGE_KEY, initial]] : []);
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => void data.set(key, value),
  };
}

describe('libraryAdapter', () => {
  it('starts without items, saves them and loads them again', () => {
    const storage = memory();
    const adapter = libraryAdapter(storage);
    expect(adapter.load()).toBeNull();

    const items = [{ id: 'a', status: 'published', elements: [], created: 1 }] as never;
    adapter.save({ libraryItems: items });

    expect(libraryAdapter(storage).load()).toEqual({ libraryItems: items });
  });

  it('ignores a stored value that is not a list', () => {
    expect(libraryAdapter(memory('{"x":1}')).load()).toBeNull();
    expect(libraryAdapter(memory('not json')).load()).toBeNull();
  });

  it('works without storage and when storage refuses', () => {
    expect(libraryAdapter(null).load()).toBeNull();
    expect(() => libraryAdapter(null).save({ libraryItems: [] })).not.toThrow();
    const full: LibraryStorage = {
      getItem: () => null,
      setItem: () => {
        throw new Error('quota');
      },
    };
    expect(() => libraryAdapter(full).save({ libraryItems: [] })).not.toThrow();
  });
});

describe('parseAddLibrary', () => {
  it('reads the library and the token, and leaves the rest of the hash', () => {
    const hash = `#addLibrary=${encodeURIComponent('https://libraries.excalidraw.com/libraries/a/b.excalidrawlib')}&token=abc&other=1`;

    expect(parseAddLibrary(hash)).toEqual({
      url: 'https://libraries.excalidraw.com/libraries/a/b.excalidrawlib',
      token: 'abc',
      rest: '#other=1',
    });
  });

  it('gives null without addLibrary', () => {
    expect(parseAddLibrary('')).toBeNull();
    expect(parseAddLibrary('#token=abc')).toBeNull();
  });
});

describe('isAllowedLibraryUrl', () => {
  it('allows the library site and the repository of the libraries, over https', () => {
    expect(
      isAllowedLibraryUrl('https://libraries.excalidraw.com/libraries/a/b.excalidrawlib'),
    ).toBe(true);
    expect(
      isAllowedLibraryUrl(
        'https://raw.githubusercontent.com/excalidraw/excalidraw-libraries/main/libraries/a.excalidrawlib',
      ),
    ).toBe(true);
  });

  it('refuses everything else', () => {
    for (const url of [
      'http://libraries.excalidraw.com/a.excalidrawlib',
      'https://libraries.excalidraw.com.evil.example/a.excalidrawlib',
      'https://evil.example/libraries.excalidraw.com/a.excalidrawlib',
      'https://raw.githubusercontent.com/someone/else/main/a.excalidrawlib',
      'https://user:pass@libraries.excalidraw.com/a.excalidrawlib',
      'javascript:alert(1)',
      'not a url',
      '',
    ]) {
      expect(isAllowedLibraryUrl(url), url).toBe(false);
    }
  });
});
