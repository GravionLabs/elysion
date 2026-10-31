import { ComponentFixture, TestBed } from '@angular/core/testing';
import { PresentMenu } from './present-menu';

describe('PresentMenu', () => {
  let fixture: ComponentFixture<PresentMenu>;
  let events: string[];
  const el = () => fixture.nativeElement as HTMLElement;
  const trigger = () => el().querySelector('button') as HTMLButtonElement;
  const items = () => [...el().querySelectorAll('[role="menuitem"]')] as HTMLButtonElement[];

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [PresentMenu] }).compileComponents();
    fixture = TestBed.createComponent(PresentMenu);
    events = [];
    fixture.componentInstance.startRequested.subscribe(() => events.push('start'));
    fixture.componentInstance.stopRequested.subscribe(() => events.push('stop'));
    fixture.componentInstance.summonRequested.subscribe(() => events.push('summon'));
    await fixture.whenStable();
  });

  const open = async () => {
    trigger().click();
    await fixture.whenStable();
  };

  it('has a Present button and a closed menu', () => {
    expect(trigger().textContent).toContain('Present');
    expect(trigger().getAttribute('aria-haspopup')).toBe('menu');
    expect(trigger().getAttribute('aria-expanded')).toBe('false');
    expect(items()).toEqual([]);
  });

  it('offers to start presenting and to bring everyone', async () => {
    await open();

    expect(items().map((item) => item.textContent?.trim())).toEqual([
      'Start presenting',
      'Bring everyone to me',
    ]);
  });

  it('starts presenting and closes the menu', async () => {
    await open();
    items()[0].click();
    await fixture.whenStable();

    expect(events).toEqual(['start']);
    expect(items()).toEqual([]);
  });

  it('offers to stop while this person presents', async () => {
    fixture.componentRef.setInput('presenting', true);
    await open();

    expect(items()[0].textContent?.trim()).toBe('Stop presenting');
    items()[0].click();
    expect(events).toEqual(['stop']);
  });

  it('brings everyone to the person', async () => {
    await open();
    items()[1].click();

    expect(events).toEqual(['summon']);
  });

  it('marks the button while somebody presents', async () => {
    expect(trigger().classList.contains('active')).toBe(false);

    fixture.componentRef.setInput('active', true);
    await fixture.whenStable();

    expect(trigger().classList.contains('active')).toBe(true);
  });

  it('closes on Escape and on a click outside', async () => {
    await open();
    el().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await fixture.whenStable();
    expect(items()).toEqual([]);

    await open();
    document.body.click();
    await fixture.whenStable();
    expect(items()).toEqual([]);
  });
});
