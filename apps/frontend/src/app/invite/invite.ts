import { HttpErrorResponse } from '@angular/common/http';
import { Location } from '@angular/common';
import { Component, effect, inject, input, signal, untracked } from '@angular/core';
import { Title } from '@angular/platform-browser';
import { Router, RouterLink } from '@angular/router';
import { InvitationsApi } from '../share/invitations-api';

export type InviteState = 'joining' | 'gone' | 'unknown' | 'failed';

/**
 * The page behind an invitation link (`/invite/:token`, #734): the login guard has made sure there is a person, the link is
 * used, and the person lands on the board or room they now belong to. The token is taken out of the address at once, so it does
 * not stay in the history (the response header `Referrer-Policy: no-referrer` keeps it from other sites); it is never logged.
 */
@Component({
  imports: [RouterLink],
  selector: 'app-invite',
  styleUrl: './invite.scss',
  templateUrl: './invite.html',
})
export class Invite {
  readonly #api = inject(InvitationsApi);
  readonly #router = inject(Router);
  readonly #location = inject(Location);
  #started = false;

  /** The token of the link, from the route. */
  readonly token = input.required<string>();
  protected readonly state = signal<InviteState>('joining');

  constructor() {
    inject(Title).setTitle($localize`:@@invite.pageTitle:Joining · Elysion`);
    effect(() => {
      const token = this.token();
      untracked(() => this.#join(token));
    });
  }

  #join(token: string): void {
    if (this.#started) return;
    this.#started = true;
    // A reload of /invite is the board list (the catch-all route), not a second use of the link.
    this.#location.replaceState('/invite');
    this.#api.accept(token).subscribe({
      next: ({ kind, id }) =>
        void this.#router.navigateByUrl(kind === 'room' ? `/rooms/${id}` : `/board/${id}`, {
          replaceUrl: true,
        }),
      error: (error: unknown) => {
        const status = error instanceof HttpErrorResponse ? error.status : 0;
        this.state.set(status === 410 ? 'gone' : status === 404 ? 'unknown' : 'failed');
      },
    });
  }
}
