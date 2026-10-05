import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ExportMenu, ExportRequest } from './export-menu';

describe('ExportMenu', () => {
  let fixture: ComponentFixture<ExportMenu>;
  let requests: ExportRequest[];
  const el = () => fixture.nativeElement as HTMLElement;
  const trigger = () => el().querySelector('button') as HTMLButtonElement;
  const menu = () => el().querySelector('[role="menu"]');
  const items = () => [...el().querySelectorAll('[role="menuitem"]')] as HTMLButtonElement[];
  const checkbox = () => el().querySelector('input[type="checkbox"]') as HTMLInputElement;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [ExportMenu] }).compileComponents();
    fixture = TestBed.createComponent(ExportMenu);
    requests = [];
    fixture.componentInstance.exportRequested.subscribe((request) => requests.push(request));
    await fixture.whenStable();
  });

  const open = async () => {
    trigger().click();
    await fixture.whenStable();
  };

  it('is closed at first and opens with the button', async () => {
    expect(menu()).toBeNull();
    expect(trigger().getAttribute('aria-expanded')).toBe('false');

    await open();

    expect(menu()).toBeTruthy();
    expect(trigger().getAttribute('aria-expanded')).toBe('true');
    expect(items().map((i) => i.textContent?.trim())).toEqual([
      'PNG image',
      'SVG image',
      'Excalidraw file',
    ]);
  });

  it.each([
    [0, 'png'],
    [1, 'svg'],
    [2, 'excalidraw'],
  ] as const)('item %i requests %s and closes the menu', async (index, format) => {
    await open();

    items()[index].click();
    await fixture.whenStable();

    expect(requests).toEqual([{ format, selectionOnly: false }]);
    expect(menu()).toBeNull();
  });

  it('offers "selection only" only when something is selected', async () => {
    await open();
    expect(checkbox().disabled).toBe(true);

    fixture.componentRef.setInput('hasSelection', true);
    await fixture.whenStable();
    expect(checkbox().disabled).toBe(false);

    checkbox().click();
    items()[0].click();
    expect(requests).toEqual([{ format: 'png', selectionOnly: true }]);
  });

  it('does not export the selection once nothing is selected any more', async () => {
    fixture.componentRef.setInput('hasSelection', true);
    await open();
    checkbox().click();

    fixture.componentRef.setInput('hasSelection', false);
    await fixture.whenStable();
    items()[0].click();

    expect(requests).toEqual([{ format: 'png', selectionOnly: false }]);
  });

  it('closes on Escape and on a click outside, but not on a click inside', async () => {
    await open();
    menu()!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await fixture.whenStable();
    expect(menu()).toBeTruthy();

    document.body.click();
    await fixture.whenStable();
    expect(menu()).toBeNull();

    await open();
    el().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await fixture.whenStable();
    expect(menu()).toBeNull();
  });
});
