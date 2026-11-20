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
  templateUrl: './app-brand.html',
})
export class AppBrand {}
