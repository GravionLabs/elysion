import { DOCUMENT } from '@angular/common';
import { Injectable, LOCALE_ID, inject } from '@angular/core';

export type Language = 'en' | 'de';

export const LANGUAGES: readonly { code: Language; name: string }[] = [
  { code: 'en', name: 'English' },
  { code: 'de', name: 'Deutsch' },
];

/** The cookie nginx reads to choose the copy of the app to serve (`apps/frontend/nginx.conf`). */
export const LANGUAGE_COOKIE = 'elysion-lang';

/**
 * The language of the running app (#738). The build has one copy per language and the URL is not localized, so the
 * language is the `LOCALE_ID` the copy was built with. A switch remembers the choice in a cookie, which nginx reads
 * before `Accept-Language`, and loads the page again so the other copy is served.
 */
@Injectable({ providedIn: 'root' })
export class LanguageService {
  readonly #document = inject(DOCUMENT);

  /** The language of this copy of the app; the `ng serve` build is English. */
  readonly current: Language = inject(LOCALE_ID).toLowerCase().startsWith('de') ? 'de' : 'en';

  /** The locale for `Intl`, the same as the language. */
  readonly locale: string = this.current;

  use(language: Language): void {
    if (language === this.current) return;
    this.#document.cookie = `${LANGUAGE_COOKIE}=${language}; path=/; max-age=31536000; SameSite=Lax`;
    this.#document.location.reload();
  }
}
