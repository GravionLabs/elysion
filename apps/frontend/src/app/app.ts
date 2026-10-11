import { Component, effect, inject, untracked } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { Account } from './auth/account';
import { SessionService } from './auth/session.service';

@Component({
  imports: [RouterOutlet],
  selector: 'app-root',
  styleUrl: './app.scss',
  templateUrl: './app.html',
})
export class App {
  constructor() {
    const session = inject(SessionService);
    const account = inject(Account);
    // Whether the person administers the instance (the menu entry), asked once as soon as somebody is signed in.
    effect(() => {
      if (session.user() !== null) {
        untracked(() => account.load());
      }
    });
  }
}
