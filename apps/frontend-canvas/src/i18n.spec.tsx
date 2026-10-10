import { act, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ELEMENT_TAG_NAME } from './element';
import { hintText } from './facilitation/VoteBadges';
import {
  DICTIONARIES,
  LOCALES,
  colorName,
  createI18n,
  de,
  en,
  excalidrawLangCode,
  parseLocale,
} from './i18n';
import { Minimap } from './Minimap';
import { STICKY_COLORS } from './sticky-note';
import { Toolbar } from './Toolbar';
import { I18nProvider } from './i18n';
import { SceneStore } from './scene-store';

describe('dictionaries', () => {
  it('have the same keys in every language, of the same kind', () => {
    for (const locale of LOCALES) {
      expect(Object.keys(DICTIONARIES[locale]).sort()).toEqual(Object.keys(en).sort());
      for (const key of Object.keys(en) as (keyof typeof en)[]) {
        expect(typeof DICTIONARIES[locale][key]).toBe(typeof en[key]);
      }
    }
  });

  it('have no empty text, and German really differs from English', () => {
    for (const [key, value] of Object.entries(de)) {
      if (typeof value === 'string') expect(value.trim(), key).not.toBe('');
    }
    expect(de.undo).not.toBe(en.undo);
    expect(de.menuClear).not.toBe(en.menuClear);
  });

  it('name every sticky note color', () => {
    for (const color of STICKY_COLORS) {
      expect(colorName(en, color.name)).toBe(color.name);
      expect(colorName(de, color.name)).not.toBe('');
    }
    expect(colorName(de, 'Unknown')).toBe('Unknown');
  });

  it('format texts with holes', () => {
    expect(en.votesLeft(2, 3)).toContain('2 of 3');
    expect(de.votesLeft(2, 3)).toContain('2 von 3');
    expect(hintText(0, 3, de)).toBe(de.votesNone);
    expect(hintText(1, 3)).toBe(en.votesLeft(1, 3));
  });
});

describe('locale', () => {
  it('falls back to English for anything unknown', () => {
    expect(parseLocale('de')).toBe('de');
    expect(parseLocale('en')).toBe('en');
    expect(parseLocale('fr')).toBe('en');
    expect(parseLocale('de-DE')).toBe('en');
    expect(parseLocale('')).toBe('en');
    expect(parseLocale(null)).toBe('en');
    expect(parseLocale(undefined)).toBe('en');
  });

  it('maps to the language codes of Excalidraw', () => {
    expect(excalidrawLangCode('de')).toBe('de-DE');
    expect(excalidrawLangCode('en')).toBe('en');
  });

  it('writes numbers the way the language does', () => {
    expect(createI18n('en').percent(1)).toBe('100%');
    expect(createI18n('de').percent(1)).toMatch(/^100\s%$/);
  });
});

describe('translated components', () => {
  it('shows the toolbar in German', () => {
    render(
      <I18nProvider locale="de">
        <Toolbar
          activeTool="selection"
          onSelect={() => {}}
          onHistory={() => {}}
          onZoom={() => {}}
        />
      </I18nProvider>,
    );
    expect(screen.getByRole('toolbar', { name: 'Zeichenwerkzeuge' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Rechteck' }).getAttribute('title')).toBe(
      'Rechteck (R)',
    );
    expect(screen.getByRole('button', { name: 'Rückgängig' }).getAttribute('title')).toBe(
      'Rückgängig (Strg+Z)',
    );
  });

  it('shows the sticky note colors in German', () => {
    render(
      <I18nProvider locale="de">
        <Toolbar activeTool="selection" onSelect={() => {}} onAddSticky={() => {}} />
      </I18nProvider>,
    );
    screen.getByRole('button', { name: 'Farbe der Haftnotiz' }).click();
    return waitFor(() => expect(screen.getByRole('menuitemradio', { name: 'Haftnotiz (Gelb)' })));
  });

  it('shows the minimap in German', () => {
    const store = new SceneStore();
    render(
      <I18nProvider locale="de">
        <Minimap store={store} onPan={() => {}} />
      </I18nProvider>,
    );
    act(() =>
      store.set({
        elements: [{ x: 0, y: 0, width: 400, height: 300 }],
        scrollX: 0,
        scrollY: 0,
        zoom: 1,
        width: 800,
        height: 600,
      }),
    );
    expect(screen.getByRole('group', { name: 'Canvas-Übersicht' })).toBeTruthy();
  });

  it('stays English without a provider', () => {
    render(<Toolbar activeTool="selection" onSelect={() => {}} />);
    expect(screen.getByRole('toolbar', { name: 'Canvas tools' })).toBeTruthy();
  });
});

describe('locale attribute of the element', () => {
  const observed = (
    customElements.get(ELEMENT_TAG_NAME) as unknown as {
      observedAttributes: string[];
    }
  ).observedAttributes;

  it('is observed', () => {
    expect(observed).toContain('locale');
  });

  it('switches the language at runtime and falls back to English', async () => {
    const el = document.createElement(ELEMENT_TAG_NAME);
    document.body.appendChild(el);
    const toolbar = () => el.querySelector('[role="toolbar"]')?.getAttribute('aria-label');
    await waitFor(() => expect(toolbar()).toBe('Canvas tools'));

    el.setAttribute('locale', 'de');
    await waitFor(() => expect(toolbar()).toBe('Zeichenwerkzeuge'));

    el.setAttribute('locale', 'xx');
    await waitFor(() => expect(toolbar()).toBe('Canvas tools'));

    el.setAttribute('locale', 'de');
    await waitFor(() => expect(toolbar()).toBe('Zeichenwerkzeuge'));
    el.removeAttribute('locale');
    await waitFor(() => expect(toolbar()).toBe('Canvas tools'));

    document.body.removeChild(el);
  });

  it('translates the rejection while the canvas is not ready', async () => {
    const el = document.createElement(ELEMENT_TAG_NAME);
    el.setAttribute('locale', 'de');
    await expect(
      (el as unknown as { startTimer(ms: number): Promise<void> }).startTimer(1000),
    ).rejects.toThrow(de.errorNotReady);
  });
});
