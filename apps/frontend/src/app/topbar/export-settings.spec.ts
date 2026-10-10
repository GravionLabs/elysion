import { describe, expect, it } from 'vitest';
import {
  DEFAULT_EXPORT_SETTINGS,
  loadSettings,
  parseSettings,
  saveSettings,
  toCanvasOptions,
} from './export-settings';

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
    data,
  };
}

describe('parseSettings', () => {
  it('is the defaults for nothing and for something that is no object', () => {
    expect(parseSettings(undefined)).toEqual(DEFAULT_EXPORT_SETTINGS);
    expect(parseSettings(null)).toEqual(DEFAULT_EXPORT_SETTINGS);
    expect(parseSettings('x')).toEqual(DEFAULT_EXPORT_SETTINGS);
  });

  it('keeps the choices that are valid and replaces the others by their defaults', () => {
    const settings = parseSettings({
      pdfPages: 'whole',
      pageFormat: 'a5',
      orientation: 'landscape',
      colors: 'neon',
      scale: 2,
      background: 'yes',
    });

    expect(settings).toEqual({
      ...DEFAULT_EXPORT_SETTINGS,
      pdfPages: 'whole',
      orientation: 'landscape',
      scale: 2,
    });
  });

  it('accepts a background that is switched off', () => {
    expect(parseSettings({ background: false }).background).toBe(false);
  });
});

describe('loadSettings and saveSettings', () => {
  it('remembers what was chosen', () => {
    const storage = memoryStorage();
    saveSettings({ ...DEFAULT_EXPORT_SETTINGS, pageFormat: 'letter', scale: 3 }, storage);

    expect(loadSettings(storage)).toEqual({
      ...DEFAULT_EXPORT_SETTINGS,
      pageFormat: 'letter',
      scale: 3,
    });
  });

  it('survives an entry that is not JSON and a storage that throws', () => {
    expect(loadSettings(memoryStorage({ 'elysion.export-settings': '{broken' }))).toEqual(
      DEFAULT_EXPORT_SETTINGS,
    );
    expect(
      loadSettings({
        getItem: () => {
          throw new Error('blocked');
        },
      }),
    ).toEqual(DEFAULT_EXPORT_SETTINGS);
    expect(() =>
      saveSettings(DEFAULT_EXPORT_SETTINGS, {
        setItem: () => {
          throw new Error('blocked');
        },
      }),
    ).not.toThrow();
  });
});

describe('toCanvasOptions', () => {
  it('names the colors `theme` for the canvas and carries the selection flag', () => {
    expect(toCanvasOptions({ ...DEFAULT_EXPORT_SETTINGS, colors: 'dark' }, true)).toEqual({
      selectionOnly: true,
      background: true,
      theme: 'dark',
      scale: 1,
      pdfPages: 'auto',
      pageFormat: 'fit',
      orientation: 'auto',
    });
  });
});
