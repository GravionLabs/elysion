import { ComponentFixture, TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
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

    it('offers editors another voting under the results', () => {
      set({ session: closed(), canControl: true });
      openMenu();

      expect(text('.start h3')).toBe('Start another voting');
      (el().querySelector('form') as HTMLFormElement).dispatchEvent(new Event('submit'));
      expect(events.start).toEqual([{ name: 'Voting', votesPerPerson: 5 }]);
    });
  });
});
