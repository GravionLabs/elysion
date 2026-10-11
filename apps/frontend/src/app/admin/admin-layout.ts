import { Component, effect, inject, untracked } from '@angular/core';
import { Title } from '@angular/platform-browser';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { Account } from '../auth/account';
import { SessionService } from '../auth/session.service';
import { AppBrand } from '../shared/app-brand';
import { UserMenu } from '../topbar/user-menu';

/**
 * The frame of the administration area (ADR 0027, #659): the brand, a way back to the boards, a navigation (Overview, Users,
 * Groups, Rooms) and the page. A person who is not an administrator gets a notice with a link back instead of the pages; the
 * business backend refuses them anyway (403), this only avoids showing an error page.
 */
@Component({
  imports: [AppBrand, RouterLink, RouterLinkActive, RouterOutlet, UserMenu],
  selector: 'app-admin-layout',
  styleUrl: './admin-layout.scss',
  templateUrl: './admin-layout.html',
})
export class AdminLayout {
  protected readonly session = inject(SessionService);
  protected readonly account = inject(Account);

  constructor() {
    inject(Title).setTitle($localize`:@@admin.pageTitle:Administration · Elysion`);
    effect(() => {
      // Opened by its address before the app root asked: ask now.
      untracked(() => this.account.load());
    });
  }
}
