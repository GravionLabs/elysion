import { HttpClient } from '@angular/common/http';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  afterNextRender,
  effect,
  inject,
  input,
  signal,
} from '@angular/core';
import { firstValueFrom } from 'rxjs';

/**
 * The picture on a board's card (#729). The API wants the person's token, which an `<img src>` cannot send, so the picture is
 * fetched with the HTTP client (when the card comes into view: the list can be long) and shown from an object URL. `version` is
 * the time the picture was made: a new one is fetched, and the address carries it so that the browser keeps an unchanged one.
 */
@Component({
  selector: 'app-board-thumbnail',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `@if (url(); as src) {
    <img [src]="src" alt="" width="480" height="300" />
  }`,
  styles: `
    :host {
      display: block;
    }

    img {
      display: block;
      width: 100%;
      height: 100%;
      object-fit: cover;
    }
  `,
})
export class BoardThumbnail {
  readonly #http = inject(HttpClient);
  readonly #host = inject<ElementRef<HTMLElement>>(ElementRef);
  readonly #destroyRef = inject(DestroyRef);

  readonly boardId = input.required<string>();
  /** When the picture was made (the list's `thumbnailUpdatedAt`). */
  readonly version = input.required<string>();

  /** The object URL of the picture, or `null` until it is loaded (the card shows its initials meanwhile). */
  protected readonly url = signal<string | null>(null);
  /** Set when the card has come into view for the first time: a card nobody scrolls to costs nothing. */
  readonly #visible = signal(false);
  #objectUrl: string | null = null;
  #loaded: string | null = null;

  constructor() {
    afterNextRender(() => {
      if (typeof IntersectionObserver === 'undefined') {
        this.#visible.set(true);
        return;
      }
      const observer = new IntersectionObserver((entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          this.#visible.set(true);
          observer.disconnect();
        }
      });
      observer.observe(this.#host.nativeElement);
      this.#destroyRef.onDestroy(() => observer.disconnect());
    });
    effect(() => {
      const key = `${this.boardId()}@${this.version()}`;
      if (this.#visible() && key !== this.#loaded) {
        this.#loaded = key;
        void this.#load(this.boardId(), this.version());
      }
    });
    this.#destroyRef.onDestroy(() => this.#release());
  }

  async #load(boardId: string, version: string): Promise<void> {
    try {
      const blob = await firstValueFrom(
        this.#http.get(`/api/boards/${boardId}/thumbnail`, {
          params: { v: version },
          responseType: 'blob',
        }),
      );
      if (`${this.boardId()}@${this.version()}` !== `${boardId}@${version}`) return; // a newer one is on its way
      this.#release();
      this.#objectUrl = URL.createObjectURL(blob);
      this.url.set(this.#objectUrl);
    } catch {
      // No picture: the card keeps its initials.
    }
  }

  #release(): void {
    if (this.#objectUrl) {
      URL.revokeObjectURL(this.#objectUrl);
      this.#objectUrl = null;
    }
  }
}
