import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Typeahead, type TypeaheadOption } from './typeahead';

const ADA: TypeaheadOption = { id: 'u1', label: 'Ada Lovelace', detail: 'ada@example.com' };
const BEA: TypeaheadOption = { id: 'u2', label: 'Bea Beispiel', detail: null };

describe('Typeahead', () => {
  let fixture: ComponentFixture<Typeahead>;
  let searches: string[];
  let picks: TypeaheadOption[];
  const el = () => fixture.nativeElement as HTMLElement;
  const field = () => el().querySelector('input') as HTMLInputElement;
  const options = () => [...el().querySelectorAll('[role="option"]')] as HTMLElement[];
  const settle = async () => {
    await fixture.whenStable();
    fixture.detectChanges();
  };
  const later = (ms = 30) => new Promise((resolve) => setTimeout(resolve, ms));
  const type = async (text: string) => {
    field().value = text;
    field().dispatchEvent(new Event('input'));
    await later();
    await settle();
  };
  const key = async (name: string) => {
    const event = new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true });
    field().dispatchEvent(event);
    await settle();
    return event;
  };

  beforeEach(async () => {
    fixture = TestBed.createComponent(Typeahead);
    fixture.componentRef.setInput('label', 'Person');
    fixture.componentRef.setInput('debounceMs', 5);
    fixture.componentRef.setInput('emptyText', 'Nobody found.');
    searches = [];
    picks = [];
    fixture.componentInstance.search.subscribe((text) => searches.push(text));
    fixture.componentInstance.pick.subscribe((option) => picks.push(option));
    await settle();
  });

  it('is a combobox with a visible label and a closed list', () => {
    expect(field().getAttribute('role')).toBe('combobox');
    expect(field().getAttribute('aria-expanded')).toBe('false');
    expect(el().querySelector('.field-label')?.textContent).toBe('Person');
    expect(el().querySelector('[role="listbox"]')).toBeNull();
  });

  it('announces what was typed after a pause, and an empty text when it is too short', async () => {
    await type('a');
    await type('ad');
    await type('  ada ');

    expect(searches).toEqual(['', 'ad', 'ada']);
  });

  it('shows the options, moves with the arrow keys and tells the field which one is active', async () => {
    await type('ad');
    fixture.componentRef.setInput('options', [ADA, BEA]);
    await settle();
    expect(
      options().map((o) => [...o.querySelectorAll('span')].map((x) => x.textContent).join(' ')),
    ).toEqual(['Ada Lovelace ada@example.com', 'Bea Beispiel']);
    expect(field().getAttribute('aria-expanded')).toBe('true');

    await key('ArrowDown');
    expect(field().getAttribute('aria-activedescendant')).toBe(options()[0].id);
    expect(options()[0].getAttribute('aria-selected')).toBe('true');
    await key('ArrowDown');
    expect(field().getAttribute('aria-activedescendant')).toBe(options()[1].id);
    await key('ArrowDown');
    expect(field().getAttribute('aria-activedescendant')).toBe(options()[0].id);
    await key('ArrowUp');
    expect(field().getAttribute('aria-activedescendant')).toBe(options()[1].id);
  });

  it('picks the active option with Enter and puts its label into the field', async () => {
    await type('ad');
    fixture.componentRef.setInput('options', [ADA, BEA]);
    await settle();
    await key('ArrowDown');

    const enter = await key('Enter');

    expect(enter.defaultPrevented).toBe(true); // the form is not submitted by the pick
    expect(picks).toEqual([ADA]);
    expect(fixture.componentInstance.value()).toBe('Ada Lovelace');
    expect(field().value).toBe('Ada Lovelace');
    expect(el().querySelector('[role="listbox"]')).toBeNull();
  });

  it('leaves Enter to the form when nothing is active', async () => {
    await type('ad');
    fixture.componentRef.setInput('options', [ADA]);
    await settle();

    const enter = await key('Enter');

    expect(enter.defaultPrevented).toBe(false);
    expect(picks).toEqual([]);
  });

  it('picks with a click without taking the focus from the field', async () => {
    await type('ad');
    fixture.componentRef.setInput('options', [ADA, BEA]);
    await settle();

    const down = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
    options()[1].dispatchEvent(down);
    await settle();

    expect(down.defaultPrevented).toBe(true);
    expect(picks).toEqual([BEA]);
  });

  it('closes the list with Escape and keeps the event from reaching a dialog around it', async () => {
    await type('ad');
    fixture.componentRef.setInput('options', [ADA]);
    await settle();
    let reached = 0;
    const listener = () => (reached += 1);
    document.addEventListener('keydown', listener);

    await key('Escape');
    await key('Escape'); // the list is closed now: this one is for the dialog

    document.removeEventListener('keydown', listener);
    expect(el().querySelector('[role="listbox"]')).toBeNull();
    expect(reached).toBe(1);
  });

  it('says how many matches there are, or that there are none', async () => {
    await type('ad');
    fixture.componentRef.setInput('options', [ADA, BEA]);
    await settle();
    expect(el().querySelector('[role="status"]')?.textContent).toContain('2 matches');

    await type('zzz');
    fixture.componentRef.setInput('options', []);
    await settle();
    expect(el().querySelector('[role="status"]')?.textContent).toBe('Nobody found.');
  });

  it('reopens the list when the person types again', async () => {
    await type('ad');
    fixture.componentRef.setInput('options', [ADA]);
    await settle();
    await key('Escape');
    expect(options()).toHaveLength(0);

    await type('ada');

    expect(options()).toHaveLength(1);
  });
});
