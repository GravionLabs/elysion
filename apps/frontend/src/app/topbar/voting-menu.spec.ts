import { ComponentFixture, TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { VotingSession } from '../board/canvas-element';
import { VOTE_PRESETS, VotingMenu, type VotingRequest } from './voting-menu';

const session = (extra: Partial<VotingSession> = {}): VotingSession => ({
  id: 's1',
  name: 'Best idea',
  votesPerPerson: 5,
  status: 'open',
  startedBy: { id: 'u1', name: 'Ada' },
  myVotes: 2,
  ...extra,
});

const closed = (extra: Partial<VotingSession> = {}) =>
  session({
    status: 'closed',
    tally: [
      { elementId: 'e2', count: 4, label: 'Ship it' },
      { elementId: 'e1', count: 1, label: 'rectangle' },
    ],
    ...extra,
  });

describe('VotingMenu', () => {
  let fixture: ComponentFixture<VotingMenu>;
  const el = () => fixture.nativeElement as HTMLElement;
  const events = {
    start: [] as VotingRequest[],
    end: 0,
    clear: 0,
    focus: [] as string[],
  };
  const set = (inputs: Partial<{ session: VotingSession | null; canControl: boolean }>) => {
    for (const [name, value] of Object.entries(inputs)) fixture.componentRef.setInput(name, value);
    fixture.detectChanges();
  };
  const button = () => el().querySelector('.menu-button') as HTMLButtonElement | null;
  const openMenu = () => {
    button()!.click();
    fixture.detectChanges();
  };
  const text = (selector: string) =>
    el().querySelector(selector)?.textContent?.replace(/\s+/g, ' ').trim();

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [VotingMenu] });
    fixture = TestBed.createComponent(VotingMenu);
    events.start = [];
    events.end = 0;
    events.clear = 0;
    events.focus = [];
    const c = fixture.componentInstance;
    c.startRequested.subscribe((request) => events.start.push(request));
    c.endRequested.subscribe(() => (events.end += 1));
    c.clearRequested.subscribe(() => (events.clear += 1));
    c.elementRequested.subscribe((id) => events.focus.push(id));
    fixture.detectChanges();
  });

  describe('without a voting', () => {
    it('shows editors and owners a Voting button and viewers nothing', () => {
      set({ canControl: true });
      expect(text('.menu-button')).toBe('Voting');

      set({ canControl: false });
      expect(button()).toBeNull();
      expect(el().querySelector('.chip')).toBeNull();
    });

    it('opens a start form: a name, the presets 3, 5 and 10 and a field, five votes preselected', () => {
      set({ canControl: true });
      openMenu();

      expect((el().querySelector('#voting-name') as HTMLInputElement).value).toBe('Voting');
      expect([...el().querySelectorAll('.preset')].map((p) => p.textContent?.trim())).toEqual(
        VOTE_PRESETS.map(String),
      );
      expect(el().querySelector('.preset.selected')?.textContent?.trim()).toBe('5');
      expect((el().querySelector('.votes-field') as HTMLInputElement).value).toBe('5');
    });

    it('starts the voting with the name and the chosen number of votes, and closes the menu', () => {
      set({ canControl: true });
      openMenu();
      const name = el().querySelector('#voting-name') as HTMLInputElement;
      name.value = '  Q3 ideas ';
      name.dispatchEvent(new Event('input'));
      (el().querySelectorAll('.preset')[2] as HTMLElement).click(); // 10
      fixture.detectChanges();
      (el().querySelector('button[type="submit"]') as HTMLElement).click();
      fixture.detectChanges();

      expect(events.start).toEqual([{ name: 'Q3 ideas', votesPerPerson: 10 }]);
      expect(el().querySelector('.menu')).toBeNull();
    });

    it('names an unnamed voting "Voting" and takes any whole number in the field', () => {
      set({ canControl: true });
      openMenu();
      const name = el().querySelector('#voting-name') as HTMLInputElement;
      name.value = '   ';
      name.dispatchEvent(new Event('input'));
      const votes = el().querySelector('.votes-field') as HTMLInputElement;
      votes.value = '7';
      votes.dispatchEvent(new Event('input'));
      (el().querySelector('form') as HTMLFormElement).dispatchEvent(new Event('submit'));

      expect(events.start).toEqual([{ name: 'Voting', votesPerPerson: 7 }]);
    });

    it.each(['', 'x', '0', '-1', '2.5', '101'])('refuses "%s" votes with a message', (value) => {
      set({ canControl: true });
      openMenu();
      const votes = el().querySelector('.votes-field') as HTMLInputElement;
      votes.value = value;
      votes.dispatchEvent(new Event('input'));
      (el().querySelector('form') as HTMLFormElement).dispatchEvent(new Event('submit'));
      fixture.detectChanges();

      expect(events.start).toEqual([]);
      expect(text('[role="alert"]')).toContain('between 1 and 100');
    });

    it('closes on Escape and on a click elsewhere', () => {
      set({ canControl: true });
      openMenu();
      el().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      fixture.detectChanges();
      expect(el().querySelector('.menu')).toBeNull();

      openMenu();
      document.body.click();
      fixture.detectChanges();
      expect(el().querySelector('.menu')).toBeNull();
    });
  });

  describe('while a voting is open', () => {
    it('shows an editor the votes left on the button, and the details and End voting in the menu', () => {
      set({ session: session(), canControl: true });

      expect(text('.menu-button')).toBe('Voting · 3 left');
      expect(button()?.classList).toContain('running');
      openMenu();
      expect(text('h3')).toBe('Best idea');
      expect(text('.note')).toContain('3 of 5 votes left');
      expect(el().querySelector('form')).toBeNull(); // no second voting while one is open

      (el().querySelector('.end') as HTMLElement).click();
      expect(events.end).toBe(1);
      fixture.detectChanges();
      expect(el().querySelector('.menu')).toBeNull();
    });

    it('never goes below no votes left', () => {
      set({ session: session({ myVotes: 7 }), canControl: true });

      expect(text('.menu-button')).toBe('Voting · 0 left');
    });

    it('shows a viewer the state and nothing to click', () => {
      set({ session: session(), canControl: false });

      expect(button()).toBeNull();
      expect(text('.chip')).toBe('Voting: Best idea');
    });

    it('shows nothing about anybody else, only the number of votes of the caller', () => {
      set({ session: session(), canControl: true });
      openMenu();

      expect(el().textContent).not.toContain('Ada'); // not even who started it
      expect(el().querySelector('.results')).toBeNull();
    });
  });

  describe('the results', () => {
    it('shows everybody a Results button and the ranked list with the counts, and no names', () => {
      set({ session: closed(), canControl: false });

      expect(text('.menu-button')).toBe('Results');
      openMenu();
      expect(text('h3')).toBe('Results: Best idea');
      expect(
        [...el().querySelectorAll('.result')].map(
          (r) =>
            `${r.querySelector('.label')?.textContent?.trim()}:${r.querySelector('.count')?.textContent?.trim()}`,
        ),
      ).toEqual(['Ship it:4', 'rectangle:1']);
      expect(text('.note')).toBe('5 votes in total.');
      expect(el().textContent).not.toContain('Ada');
    });

    it('scrolls to the element when a result is clicked', () => {
      set({ session: closed(), canControl: false });
      openMenu();

      (el().querySelectorAll('.result')[1] as HTMLElement).click();

      expect(events.focus).toEqual(['e1']);
    });

    it('says so when there is nothing to rank', () => {
      set({ session: closed({ tally: [] }), canControl: false });
      openMenu();

      expect(el().querySelector('.results')).toBeNull();
      expect(text('.note')).toContain('Nobody voted');
    });

    it('gives a viewer no clear button and no start form', () => {
      set({ session: closed(), canControl: false });
      openMenu();

      expect(el().querySelector('.clear')).toBeNull();
      expect(el().querySelector('form')).toBeNull();
    });

    it('asks before clearing, then clears once', () => {
      set({ session: closed(), canControl: true });
      openMenu();

      (el().querySelector('.clear') as HTMLElement).click();
      fixture.detectChanges();
      expect(events.clear).toBe(0);
      expect(text('[role="alert"]')).toContain('Clear these results?');
      expect(text('.clear')).toBe('Yes, clear the results');

      (el().querySelector('.clear') as HTMLElement).click();
      expect(events.clear).toBe(1);
    });

    it('forgets the question when the menu is closed', () => {
      set({ session: closed(), canControl: true });
      openMenu();
      (el().querySelector('.clear') as HTMLElement).click();
      fixture.detectChanges();

      openMenu(); // closes
      openMenu(); // opens again
      expect(text('.clear')).toBe('Clear results');
    });

    it('offers editors another voting from the results: the form opens under the button', () => {
      set({ session: closed(), canControl: true });
      openMenu();

      (el().querySelector('.new-voting') as HTMLElement).click();
      fixture.detectChanges();

      expect(el().querySelector('.results-dialog')).toBeNull();
      expect(text('.start h3')).toBe('Start another voting');
      (el().querySelector('form') as HTMLFormElement).dispatchEvent(new Event('submit'));
      expect(events.start).toEqual([{ name: 'Voting', votesPerPerson: 5 }]);
    });

    it('gives a viewer no New voting button', () => {
      set({ session: closed(), canControl: false });
      openMenu();

      expect(el().querySelector('.new-voting')).toBeNull();
    });
  });

  describe('when the voting ends', () => {
    const dialog = () => el().querySelector('.results-dialog');

    it('opens the results by itself for an editor, and closes the menu that ended it', () => {
      set({ session: session(), canControl: true });
      el().querySelector<HTMLElement>('.menu-button')!.click(); // the menu with End voting
      fixture.detectChanges();
      expect(dialog()).toBeNull();

      set({ session: closed() });

      expect(dialog()).not.toBeNull();
      expect(el().querySelector('.menu')).toBeNull();
      expect(text('#voting-results-title')).toBe('Results: Best idea');
    });

    it('opens them for a viewer too', () => {
      set({ session: session(), canControl: false });

      set({ session: closed() });

      expect(dialog()).not.toBeNull();
    });

    it('does not open them for somebody who finds the voting closed already (a late joiner, a reload)', () => {
      set({ session: closed(), canControl: false });

      expect(dialog()).toBeNull();
      expect(text('.menu-button')).toBe('Results');
    });

    it('does not open them again for a voting that was cleared or for the next one that is still open', () => {
      set({ session: session(), canControl: true });
      set({ session: closed() });
      expect(dialog()).not.toBeNull();

      set({ session: null });
      expect(dialog()).toBeNull();
      set({ session: session({ id: 's2' }) });
      expect(dialog()).toBeNull();
    });

    it('opens them again when the next voting ends, even if the last results were closed by hand', () => {
      set({ session: session(), canControl: true });
      set({ session: closed() });
      el().querySelector<HTMLElement>('.dialog-close')!.click();
      fixture.detectChanges();
      expect(dialog()).toBeNull();

      set({ session: session({ id: 's2' }) });
      set({ session: closed({ id: 's2' }) });

      expect(dialog()).not.toBeNull();
    });
  });

  describe('the results dialog', () => {
    const dialog = () => el().querySelector('.results-dialog') as HTMLElement | null;
    const header = () => el().querySelector('.dialog-header') as HTMLElement;
    const pointer = (type: string, x: number, y: number, target: Element = header()) =>
      target.dispatchEvent(
        new MouseEvent(type, {
          clientX: x,
          clientY: y,
          button: 0,
          bubbles: true,
          cancelable: true,
        }),
      );
    /** The dialog as a browser would lay it out: jsdom has no layout, so the box is given. */
    const layOut = (left: number, top: number) => {
      const box = { left, top, width: 320, height: 300, right: left + 320, bottom: top + 300 };
      vi.spyOn(dialog()!, 'getBoundingClientRect').mockReturnValue({
        ...box,
        x: left,
        y: top,
        toJSON: () => box,
      });
      Object.defineProperty(dialog()!, 'offsetWidth', { value: 320, configurable: true });
    };

    beforeEach(() => {
      set({ session: closed(), canControl: true });
      openMenu();
    });

    it('is a dialog with a title, and it does not block the board: no backdrop', () => {
      expect(dialog()?.getAttribute('role')).toBe('dialog');
      expect(dialog()?.getAttribute('aria-labelledby')).toBe('voting-results-title');
      expect(text('#voting-results-title')).toBe('Results: Best idea');
      expect(el().querySelector('.backdrop')).toBeNull();
      expect(dialog()?.getAttribute('aria-modal')).toBeNull();
    });

    it('sits on the right of the window until it is moved', () => {
      expect(dialog()!.style.right).toBe('16px');
      expect(dialog()!.style.left).toBe('');
      expect(dialog()!.style.top).toBe('');
    });

    it('moves with the title: the dialog follows the pointer by where it was grabbed', () => {
      layOut(688, 64);
      pointer('pointerdown', 700, 80); // grabbed 12 px from the left and 16 px from the top
      pointer('pointermove', 400, 220);
      fixture.detectChanges();

      expect(dialog()!.style.left).toBe('388px');
      expect(dialog()!.style.top).toBe('204px');
      expect(dialog()!.style.right).toBe(''); // the right alignment is given up once it is moved

      pointer('pointerup', 400, 220);
      pointer('pointermove', 100, 100); // no longer dragging
      fixture.detectChanges();
      expect(dialog()!.style.left).toBe('388px');
    });

    it('stays inside the window, so its title can always be reached', () => {
      layOut(688, 64);
      pointer('pointerdown', 700, 80);
      pointer('pointermove', 5000, 5000);
      fixture.detectChanges();
      expect(dialog()!.style.left).toBe(`${window.innerWidth - 320}px`);
      expect(dialog()!.style.top).toBe(`${window.innerHeight - 48}px`);

      pointer('pointermove', -500, -500);
      fixture.detectChanges();
      expect(dialog()!.style.left).toBe('0px');
      expect(dialog()!.style.top).toBe('0px');
    });

    it('is not dragged by a press on its buttons', () => {
      layOut(688, 64);
      pointer('pointerdown', 700, 80, el().querySelector('.dialog-close') as Element);
      pointer('pointermove', 100, 100);
      fixture.detectChanges();

      expect(dialog()!.style.left).toBe('');
    });

    it('moves with the arrow keys on the move button, 16 pixels at a time', () => {
      layOut(688, 64);
      const handle = el().querySelector('.drag-handle') as HTMLElement;

      handle.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true, cancelable: true }),
      );
      fixture.detectChanges();
      expect(dialog()!.style.left).toBe('672px');
      expect(dialog()!.style.top).toBe('64px');

      handle.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
      fixture.detectChanges();
      expect(dialog()!.style.left).toBe('672px'); // other keys do nothing
    });

    it('keeps its place when it is closed and opened again', () => {
      layOut(688, 64);
      pointer('pointerdown', 700, 80);
      pointer('pointermove', 400, 220);
      pointer('pointerup', 400, 220);
      fixture.detectChanges();

      (el().querySelector('.dialog-close') as HTMLElement).click();
      fixture.detectChanges();
      expect(dialog()).toBeNull();
      openMenu();

      expect(dialog()!.style.left).toBe('388px');
    });

    it('closes with its button, with Escape and with the Results button, but not with a click elsewhere', () => {
      (el().querySelector('.dialog-close') as HTMLElement).click();
      fixture.detectChanges();
      expect(dialog()).toBeNull();

      openMenu();
      el().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      fixture.detectChanges();
      expect(dialog()).toBeNull();

      openMenu();
      document.body.click(); // the board behind it stays usable and the dialog stays
      fixture.detectChanges();
      expect(dialog()).not.toBeNull();

      openMenu(); // the Results button again
      expect(dialog()).toBeNull();
    });

    it('goes away when the voting is cleared or another one starts, and forgets a clear question', () => {
      (el().querySelector('.clear') as HTMLElement).click();
      fixture.detectChanges();
      expect(text('[role="alert"]')).toContain('Clear these results?');

      set({ session: session() }); // another voting is open now
      expect(dialog()).toBeNull();

      set({ session: closed() }); // it ended: the results open by themselves
      expect(text('.clear')).toBe('Clear results');
    });

    it('shows the ranked list with counts and no names, and a click scrolls to the element', () => {
      expect(
        [...el().querySelectorAll('.result')].map(
          (r) =>
            `${r.querySelector('.label')?.textContent?.trim()}:${r.querySelector('.count')?.textContent?.trim()}`,
        ),
      ).toEqual(['Ship it:4', 'rectangle:1']);
      expect(dialog()!.textContent).not.toContain('Ada');

      (el().querySelectorAll('.result')[1] as HTMLElement).click();

      expect(events.focus).toEqual(['e1']);
    });
  });
});
