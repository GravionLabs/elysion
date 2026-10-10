import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';

/**
 * The Elysion mark and name; it links to the board list from every page. The mark is the project icon
 * (`public/icon.svg`, the source of the favicon and the app icons) as inline SVG: its colors are fixed and
 * read on the light and the dark theme alike, because the gradient square carries it.
 */
@Component({
  imports: [RouterLink],
  selector: 'app-brand',
  styles: `
    :host {
      display: inline-flex;
    }

    .brand {
      display: flex;
      align-items: center;
      gap: 10px;
      color: inherit;
      text-decoration: none;
      border-radius: var(--radius-md);
    }

    .brand:focus-visible {
      outline: 2px solid var(--c-focus);
      outline-offset: 4px;
    }

    .brand-mark {
      display: block;
      width: 28px;
      height: 28px;
    }

    .app-title {
      font-size: 15px;
      font-weight: 700;
      letter-spacing: -0.01em;
    }
  `,
  template: `
    <a
      class="brand"
      routerLink="/"
      aria-label="Elysion: all boards"
      i18n-aria-label="@@app.brand.label"
    >
      <svg class="brand-mark" viewBox="0 0 64 64" aria-hidden="true">
        <defs>
          <linearGradient id="elysion-mark-gradient" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stop-color="#6366f1" />
            <stop offset="1" stop-color="#8b5cf6" />
          </linearGradient>
        </defs>
        <rect width="64" height="64" rx="14" fill="url(#elysion-mark-gradient)" />
        <rect x="12" y="12" width="26" height="26" rx="5" fill="#fff" fill-opacity="0.55" />
        <rect x="26" y="26" width="26" height="26" rx="5" fill="#fff" />
        <path
          d="M32 36h14M32 43h9"
          stroke="#6366f1"
          stroke-width="4"
          stroke-linecap="round"
          fill="none"
        />
      </svg>
      <span class="app-title">Elysion</span>
    </a>
  `,
})
export class AppBrand {}
