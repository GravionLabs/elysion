import { Component, ElementRef, HostListener, inject, input, output, signal } from '@angular/core';
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

  /** Whether anything is selected on the canvas (enables saving the selection). */
  readonly hasSelection = input(false);

  /** The user chose a template to add. */
  readonly templateChosen = output<TemplateInfo>();
  /** The user wants to save the board, or the selection, as a template. */
  readonly saveRequested = output<{ selectionOnly: boolean }>();

  protected readonly open = signal(false);
  protected readonly state = signal<MenuState>('loading');
  protected readonly templates = signal<TemplateInfo[]>([]);
  /** The own template whose deletion waits for a second click. */
  protected readonly confirmingId = signal<string | null>(null);
  protected readonly deleteError = signal<string | null>(null);

  protected toggle(): void {
    this.open.update((open) => !open);
    this.confirmingId.set(null);
    this.deleteError.set(null);
    if (this.open()) {
      this.load(); // every time: the user may have saved or deleted templates since
    }
  }

  protected load(): void {
    if (this.state() !== 'ready') {
      this.state.set('loading'); // an old list stays visible while a fresh one is fetched
    }
    this.#api.list().subscribe({
      next: (templates) => {
        this.templates.set(templates);
        this.state.set('ready');
      },
      error: () => this.state.set('error'),
    });
  }

  protected save(selectionOnly: boolean): void {
    this.open.set(false);
    this.saveRequested.emit({ selectionOnly });
  }

  /** The first click asks, the second one deletes the user's own template. */
  protected askDelete(template: TemplateInfo): void {
    this.deleteError.set(null);
    this.confirmingId.set(template.id);
  }

  protected confirmDelete(template: TemplateInfo): void {
    this.#api.delete(template.id).subscribe({
      next: () => {
        this.confirmingId.set(null);
        this.templates.update((all) => all.filter((t) => t.id !== template.id));
      },
      error: () => {
        this.confirmingId.set(null);
        this.deleteError.set(
          $localize`:@@topbar.templates.delete-error:The template “${template.name}:name:” could not be deleted.`,
        );
      },
    });
  }

  protected choose(template: TemplateInfo): void {
    this.open.set(false);
    this.templateChosen.emit(template);
  }

  protected deleteLabel(name: string): string {
    return $localize`:@@topbar.templates.delete-aria:Delete the template ${name}:name:`;
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
