import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';

/** The Elysion mark and name; it links to the board list from every page. */
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
      display: grid;
      width: 28px;
      height: 28px;
      place-items: center;
      color: var(--c-on-primary);
      font-size: 15px;
      font-weight: 700;
      background: linear-gradient(135deg, var(--c-primary), var(--c-node-purple));
      border-radius: 8px;
      box-shadow: 0 2px 6px rgba(99, 102, 241, 0.35);
    }

    .app-title {
      font-size: 15px;
      font-weight: 700;
      letter-spacing: -0.01em;
    }
  `,
  template: `
    <a class="brand" routerLink="/" aria-label="Elysion: all boards">
      <span class="brand-mark" aria-hidden="true">E</span>
      <span class="app-title">Elysion</span>
    </a>
  `,
})
export class AppBrand {}
