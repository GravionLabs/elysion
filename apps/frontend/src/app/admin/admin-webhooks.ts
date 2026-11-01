import { Component, inject } from '@angular/core';
import { Title } from '@angular/platform-browser';
import { Webhooks } from '../share/webhooks';
import { ADMIN_WEBHOOKS_BASE } from '../share/webhooks-api';

/**
 * Webhooks for every board (#853, ADR 0033): an administrator's endpoints hear the events of all boards of the instance, also of
 * boards made later. The same section as a board owner's in the Share dialog, always open.
 */
@Component({
  imports: [Webhooks],
  selector: 'app-admin-webhooks',
  styleUrl: './admin-shared.scss',
  template: `
    <h1 i18n="@@admin.webhooks.title">Webhooks</h1>
    <p class="lead" i18n="@@admin.webhooks.lead">
      These webhooks receive the events of every board of this instance. Board owners add webhooks
      for their own boards in the board's Share dialog.
    </p>
    <app-webhooks [base]="base" [collapsible]="false" />
  `,
})
export class AdminWebhooks {
  protected readonly base = ADMIN_WEBHOOKS_BASE;

  constructor() {
    inject(Title).setTitle(
      $localize`:@@admin.webhooks.pageTitle:Webhooks · Administration · Elysion`,
    );
  }
}
