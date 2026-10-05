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
      'PDF document',
      'Excalidraw file',
    ]);
  });

  it.each([
    [0, 'png'],
    [1, 'svg'],
    [2, 'pdf'],
    [3, 'excalidraw'],
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

  it('asks for a PDF, for the selection when that is chosen', async () => {
    fixture.componentRef.setInput('hasSelection', true);
    await open();
    checkbox().click();
    await fixture.whenStable();

    items()[2].click();

    expect(requests).toEqual([{ format: 'pdf', selectionOnly: true }]);
  });

  describe('while a file is being prepared', () => {
    beforeEach(async () => {
      fixture.componentRef.setInput('busy', 'pdf');
      await fixture.whenStable();
    });

    it('says what it is preparing on the button', () => {
      expect(trigger().textContent).toContain('Preparing PDF…');
      expect(trigger().getAttribute('aria-busy')).toBe('true');
    });

    it('names the format that is being prepared', async () => {
      fixture.componentRef.setInput('busy', 'png');
      await fixture.whenStable();

      expect(trigger().textContent).toContain('Preparing PNG…');
    });

    it('does not start a second export: the items are disabled and a request is ignored', async () => {
      await open();

      expect(items().every((item) => item.disabled)).toBe(true);
      items()[0].click();
      expect(requests).toEqual([]);
    });

    it('goes back to "Export" when it is done', async () => {
      fixture.componentRef.setInput('busy', null);
      await fixture.whenStable();

      expect(trigger().textContent).toContain('Export');
      expect(trigger().getAttribute('aria-busy')).toBe('false');
    });
  });
});
