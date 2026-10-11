import {
  Component,
  DestroyRef,
  ElementRef,
  computed,
  inject,
  input,
  model,
  output,
  signal,
  viewChild,
} from '@angular/core';

/** One entry of the list: `label` is what goes into the field when it is picked, `detail` a second line (an email, a source). */
export interface TypeaheadOption {
  id: string;
  label: string;
  detail?: string | null;
}

let nextId = 0;

/**
 * A text field that offers matches while the person types (the ARIA combobox pattern with a listbox, 1.2): the field keeps the
 * focus, Arrow keys move through the options, Enter picks the active one, Escape closes the list (and only that: the dialog
 * around it stays), a click picks too. It searches nothing itself: after a short pause it announces what was typed (`search`,
 * an empty text when it is too short) and shows the `options` the parent hands back. Typing again takes the pick back.
 */
@Component({
  selector: 'app-typeahead',
  styleUrl: './typeahead.scss',
  templateUrl: './typeahead.html',
})
export class Typeahead {
  readonly #destroyRef = inject(DestroyRef);
  readonly #id = `typeahead-${nextId++}`;
  #timer: ReturnType<typeof setTimeout> | undefined;

  /** The visible label above the field. */
  readonly label = input.required<string>();
  readonly placeholder = input('');
  readonly disabled = input(false);
  /** How many characters make a search; with fewer, `search` is announced with an empty text and no list is shown. */
  readonly minLength = input(2);
  readonly debounceMs = input(250);
  /** What the search found, best first. */
  readonly options = input<readonly TypeaheadOption[]>([]);
  /** The search is on its way. */
  readonly busy = input(false);
  /** Said (as a status) when a search of enough characters found nothing. */
  readonly emptyText = input('');
  /** What the field holds. */
  readonly value = model('');

  /** The person stopped typing: the trimmed text, or `''` when it is too short to search for. */
  readonly search = output<string>();
  /** An option was chosen. */
  readonly pick = output<TypeaheadOption>();

  protected readonly listId = `${this.#id}-list`;
  protected readonly active = signal(-1);
  /** The list is closed by Escape, a pick or leaving the field, and opens again when the person types or presses an arrow. */
  protected readonly dismissed = signal(true);
  /** Whether a search for the current text was asked for and has not changed since. */
  protected readonly searched = signal(false);

  protected readonly open = computed(() => !this.dismissed() && this.options().length > 0);
  protected readonly status = computed(() => {
    if (this.busy()) {
      return $localize`:@@typeahead.searching:Searching…`;
    }
    const count = this.options().length;
    if (!this.searched()) {
      return '';
    }
    return count === 0 ? this.emptyText() : this.#resultsText(count);
  });

  private readonly field = viewChild.required<ElementRef<HTMLInputElement>>('field');

  constructor() {
    this.#destroyRef.onDestroy(() => clearTimeout(this.#timer));
  }

  focus(): void {
    this.field().nativeElement.focus();
  }

  protected optionId(index: number): string {
    return `${this.#id}-option-${index}`;
  }

  protected onInput(event: Event): void {
    const text = (event.target as HTMLInputElement).value;
    this.value.set(text);
    this.active.set(-1);
    this.dismissed.set(false);
    this.searched.set(false);
    clearTimeout(this.#timer);
    const trimmed = text.trim();
    if (trimmed.length < this.minLength()) {
      this.search.emit('');
      return;
    }
    this.#timer = setTimeout(() => {
      this.searched.set(true);
      this.search.emit(trimmed);
    }, this.debounceMs());
  }

  protected onKeydown(event: KeyboardEvent): void {
    const count = this.options().length;
    switch (event.key) {
      case 'ArrowDown':
      case 'ArrowUp': {
        if (count === 0) {
          return;
        }
        event.preventDefault();
        if (this.dismissed()) {
          this.dismissed.set(false);
          this.active.set(event.key === 'ArrowDown' ? 0 : count - 1);
          return;
        }
        const step = event.key === 'ArrowDown' ? 1 : -1;
        this.active.set((this.active() + step + count) % count);
        return;
      }
      case 'Enter': {
        const option = this.options()[this.active()];
        if (this.open() && option) {
          // Not the form's Enter: the person picks, then presses Add.
          event.preventDefault();
          this.#choose(option);
        }
        return;
      }
      case 'Escape': {
        if (this.open()) {
          // Closes the list only: the dialog around the field stays.
          event.preventDefault();
          event.stopPropagation();
          this.dismissed.set(true);
          this.active.set(-1);
        }
        return;
      }
      default:
        return;
    }
  }

  protected onBlur(): void {
    this.dismissed.set(true);
    this.active.set(-1);
  }

  protected choose(event: MouseEvent, option: TypeaheadOption): void {
    // The field keeps the focus: a mousedown on the list would move it.
    event.preventDefault();
    this.#choose(option);
  }

  #choose(option: TypeaheadOption): void {
    clearTimeout(this.#timer);
    this.value.set(option.label);
    this.dismissed.set(true);
    this.active.set(-1);
    this.pick.emit(option);
  }

  #resultsText(count: number): string {
    return count === 1
      ? $localize`:@@typeahead.results.one:1 match. Use the arrow keys to choose.`
      : $localize`:@@typeahead.results.many:${count}:count: matches. Use the arrow keys to choose.`;
  }
}
