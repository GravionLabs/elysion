import { DOCUMENT } from '@angular/common';
import { DestroyRef, Injectable, computed, effect, inject, signal } from '@angular/core';

export type Theme = 'light' | 'dark';

const STORAGE_KEY = 'elysion.theme';
const DARK_QUERY = '(prefers-color-scheme: dark)';

function readStored(): Theme | null {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    return value === 'light' || value === 'dark' ? value : null;
  } catch {
    return null; // blocked or unavailable storage must not break the page
  }
}

function writeStored(theme: Theme): void {
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // The choice then lasts for this visit only.
  }
}

function systemTheme(): Theme {
  return window.matchMedia?.(DARK_QUERY).matches ? 'dark' : 'light';
}

/**
 * The app-wide theme: the explicit choice if there is one (kept across visits), otherwise the system
 * preference, followed live. It is written to `data-theme` on <html>, where the design tokens read it,
 * and handed to the canvas as its `theme` attribute.
 */
@Injectable({ providedIn: 'root' })
export class ThemeService {
  readonly #document = inject(DOCUMENT);
  readonly #stored = signal<Theme | null>(readStored());
  readonly #system = signal<Theme>(systemTheme());

  readonly theme = computed<Theme>(() => this.#stored() ?? this.#system());

  constructor() {
    const query = window.matchMedia?.(DARK_QUERY);
    if (query) {
      const onChange = () => this.#system.set(query.matches ? 'dark' : 'light');
      query.addEventListener('change', onChange);
      inject(DestroyRef).onDestroy(() => query.removeEventListener('change', onChange));
    }
    effect(() => this.#document.documentElement.setAttribute('data-theme', this.theme()));
  }

  /** An explicit choice: it wins over the system preference and is remembered. */
  set(theme: Theme): void {
    this.#stored.set(theme);
    writeStored(theme);
  }

  toggle(): void {
    this.set(this.theme() === 'dark' ? 'light' : 'dark');
  }
}
