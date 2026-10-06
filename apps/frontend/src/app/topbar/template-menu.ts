import { Component, ElementRef, HostListener, inject, output, signal } from '@angular/core';
import { TemplateApi, TemplateInfo } from '../board/template-api';

type MenuState = 'loading' | 'ready' | 'error';

/**
 * The Templates menu of the top bar: the catalog (loaded when the menu is first opened), and a choice that
 * the board page adds to the board around the middle of the view.
 */
@Component({
  selector: 'app-template-menu',
  styleUrl: './template-menu.scss',
  templateUrl: './template-menu.html',
})
export class TemplateMenu {
  readonly #host = inject<ElementRef<HTMLElement>>(ElementRef);
  readonly #api = inject(TemplateApi);

  /** The user chose a template to add. */
  readonly templateChosen = output<TemplateInfo>();

  protected readonly open = signal(false);
  protected readonly state = signal<MenuState>('loading');
  protected readonly templates = signal<TemplateInfo[]>([]);

  protected toggle(): void {
    this.open.update((open) => !open);
    if (this.open() && this.state() !== 'ready') {
      this.load();
    }
  }

  protected load(): void {
    this.state.set('loading');
    this.#api.list().subscribe({
      next: (templates) => {
        this.templates.set(templates);
        this.state.set('ready');
      },
      error: () => this.state.set('error'),
    });
  }

  protected choose(template: TemplateInfo): void {
    this.open.set(false);
    this.templateChosen.emit(template);
  }

  @HostListener('document:click', ['$event'])
  protected closeOnOutsideClick(event: Event): void {
    if (this.open() && !this.#host.nativeElement.contains(event.target as Node)) {
      this.open.set(false);
    }
  }

  @HostListener('keydown.escape')
  protected closeOnEscape(): void {
    this.open.set(false);
  }
}
