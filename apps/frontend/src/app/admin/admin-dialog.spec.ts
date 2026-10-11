import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { AdminDialog } from './admin-dialog';

@Component({
  imports: [AdminDialog],
  template: `
    <button id="opener" type="button">open</button>
    @if (open()) {
      <app-admin-dialog heading="Details" (closed)="open.set(false)">
        <input id="first" type="text" />
        <button id="last" type="button">last</button>
      </app-admin-dialog>
    }
  `,
})
class Host {
  readonly open = signal(false);
}

describe('AdminDialog', () => {
  const setup = async () => {
    const fixture = TestBed.createComponent(Host);
    document.body.appendChild(fixture.nativeElement);
    await fixture.whenStable();
    (fixture.nativeElement.querySelector('#opener') as HTMLElement).focus();
    fixture.componentInstance.open.set(true);
    await fixture.whenStable();
    await Promise.resolve();
    return fixture;
  };
  const el = (fixture: { nativeElement: HTMLElement }) => fixture.nativeElement;

  it('is a modal dialog named by its heading, with the focus inside', async () => {
    const fixture = await setup();

    const dialog = el(fixture).querySelector('[role="dialog"]')!;
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(
      el(fixture).querySelector(`#${dialog.getAttribute('aria-labelledby')}`)?.textContent,
    ).toBe('Details');
    expect(dialog.contains(document.activeElement)).toBe(true);
    fixture.nativeElement.remove();
  });

  it('closes with Escape, the close button and a click outside, and gives the focus back', async () => {
    const fixture = await setup();
    const opener = el(fixture).querySelector('#opener') as HTMLElement;

    el(fixture)
      .querySelector('[role="dialog"]')!
      .dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await fixture.whenStable();
    expect(el(fixture).querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(opener);

    fixture.componentInstance.open.set(true);
    await fixture.whenStable();
    (el(fixture).querySelector('.close') as HTMLButtonElement).click();
    await fixture.whenStable();
    expect(el(fixture).querySelector('[role="dialog"]')).toBeNull();

    fixture.componentInstance.open.set(true);
    await fixture.whenStable();
    (el(fixture).querySelector('.backdrop') as HTMLElement).click();
    await fixture.whenStable();
    expect(el(fixture).querySelector('[role="dialog"]')).toBeNull();
    fixture.nativeElement.remove();
  });

  it('closes with Escape also when the focus has fallen to the page', async () => {
    const fixture = await setup();
    (document.activeElement as HTMLElement).blur();

    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await fixture.whenStable();

    expect(el(fixture).querySelector('[role="dialog"]')).toBeNull();
    fixture.nativeElement.remove();
  });

  it('keeps Tab inside: from the last control to the first and back', async () => {
    const fixture = await setup();
    const close = el(fixture).querySelector('.close') as HTMLElement;
    const last = el(fixture).querySelector('#last') as HTMLElement;
    const dialog = el(fixture).querySelector('[role="dialog"]')!;

    last.focus();
    dialog.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }),
    );
    expect(document.activeElement).toBe(close);

    dialog.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true }),
    );
    expect(document.activeElement).toBe(last);
    fixture.nativeElement.remove();
  });
});
