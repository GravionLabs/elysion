import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { TopBar } from './top-bar';

describe('TopBar', () => {
  let fixture: ComponentFixture<TopBar>;
  const el = () => fixture.nativeElement as HTMLElement;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [TopBar],
      providers: [provideRouter([])],
    }).compileComponents();
    fixture = TestBed.createComponent(TopBar);
    fixture.componentRef.setInput('boardId', 'team-retro');
    fixture.componentRef.setInput('theme', 'light');
    await fixture.whenStable();
  });

  it('links back to the board list from the brand and from "All boards"', () => {
    const brand = el().querySelector('a.brand') as HTMLAnchorElement;
    const back = el().querySelector('a.all-boards') as HTMLAnchorElement;

    expect(brand.getAttribute('href')).toBe('/');
    expect(back.getAttribute('href')).toBe('/');
    expect(back.textContent).toContain('All boards');
  });

  it('shows the app title', () => {
    expect(el().querySelector('.app-title')?.textContent).toContain('Elysion');
  });

  it('shows the board id while the board has no name', () => {
    expect(el().querySelector('.board-title')?.textContent).toContain('team-retro');
  });

  it('shows the board name once it is known and keeps the id as a tooltip', async () => {
    fixture.componentRef.setInput('boardName', 'Q3 planning');
    await fixture.whenStable();

    const title = el().querySelector('.board-title') as HTMLElement;
    expect(title.textContent).toContain('Q3 planning');
    expect(title.title).toBe('team-retro');
  });

  it.each([
    ['connecting', 'Connecting…'],
    ['connected', 'Connected'],
    ['disconnected', 'Offline'],
  ] as const)('announces the %s status as "%s"', async (status, label) => {
    fixture.componentRef.setInput('status', status);
    await fixture.whenStable();

    const chip = el().querySelector('[role="status"]') as HTMLElement;
    expect(chip.textContent).toContain(label);
    expect(chip.getAttribute('data-status')).toBe(status);
  });

  it('offers the theme to switch to, like ariadne', async () => {
    const button = () => el().querySelector('.theme-toggle') as HTMLButtonElement;
    expect(button().textContent).toContain('Dark');
    expect(button().getAttribute('aria-label')).toBe('Switch to the dark theme');

    fixture.componentRef.setInput('theme', 'dark');
    await fixture.whenStable();

    expect(button().textContent).toContain('Light');
    expect(button().getAttribute('aria-label')).toBe('Switch to the light theme');
  });

  it('emits when the theme button is clicked', () => {
    const toggled = vi.fn();
    fixture.componentInstance.themeToggle.subscribe(toggled);

    (el().querySelector('.theme-toggle') as HTMLButtonElement).click();

    expect(toggled).toHaveBeenCalledTimes(1);
  });

  it('has a Library button that reflects whether the sidebar is open', async () => {
    const button = () => el().querySelector('.library-toggle') as HTMLButtonElement;
    expect(button().textContent).toContain('Library');
    expect(button().getAttribute('aria-pressed')).toBe('false');

    fixture.componentRef.setInput('libraryOpen', true);
    await fixture.whenStable();

    expect(button().getAttribute('aria-pressed')).toBe('true');
    expect(button().classList).toContain('active');
  });

  it('emits when the Library button is clicked', () => {
    const toggled = vi.fn();
    fixture.componentInstance.libraryToggle.subscribe(toggled);

    (el().querySelector('.library-toggle') as HTMLButtonElement).click();

    expect(toggled).toHaveBeenCalledTimes(1);
  });

  it('hands a file picked for import to the page, and lets the same file be picked again', () => {
    const picked: File[] = [];
    fixture.componentInstance.importChosen.subscribe((file) => picked.push(file));
    const input = el().querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(['{}'], 'board.excalidraw');

    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    input.dispatchEvent(new Event('change'));

    expect(picked).toEqual([file]);
    expect(input.value).toBe('');
  });

  it('does nothing when the file dialog is cancelled', () => {
    const picked: File[] = [];
    fixture.componentInstance.importChosen.subscribe((file) => picked.push(file));
    const input = el().querySelector('input[type="file"]') as HTMLInputElement;

    Object.defineProperty(input, 'files', { value: [], configurable: true });
    input.dispatchEvent(new Event('change'));

    expect(picked).toEqual([]);
  });

  it('only accepts Excalidraw files in the file dialog', () => {
    const input = el().querySelector('input[type="file"]') as HTMLInputElement;

    expect(input.accept).toContain('.excalidraw');
  });

  it('forwards an export request from the menu and tells it about the selection', async () => {
    const requests: unknown[] = [];
    fixture.componentInstance.exportRequested.subscribe((request) => requests.push(request));
    fixture.componentRef.setInput('hasSelection', true);
    await fixture.whenStable();

    (el().querySelector('app-export-menu button') as HTMLButtonElement).click();
    await fixture.whenStable();
    (el().querySelector('[role="menuitem"]') as HTMLButtonElement).click();

    expect(requests).toEqual([{ format: 'png', selectionOnly: false }]);
    expect(
      (el().querySelector('input[type="checkbox"]') as HTMLInputElement | null)?.disabled,
    ).not.toBe(true);
  });

  describe('renaming', () => {
    const titleButton = () => el().querySelector('.title-button') as HTMLButtonElement | null;
    const field = () => el().querySelector('.title-input') as HTMLInputElement | null;
    const emitted = () => {
      const names: string[] = [];
      fixture.componentInstance.renameRequested.subscribe((name) => names.push(name));
      return names;
    };
    const type = async (value: string) => {
      field()!.value = value;
      field()!.dispatchEvent(new Event('input'));
      await fixture.whenStable();
    };
    const press = async (key: string) => {
      field()!.dispatchEvent(new KeyboardEvent('keydown', { key }));
      await fixture.whenStable();
    };

    beforeEach(async () => {
      fixture.componentRef.setInput('boardName', 'Q3 planning');
      fixture.componentRef.setInput('canRename', true);
      await fixture.whenStable();
    });

    it('is plain text for a room that is not a stored board', async () => {
      fixture.componentRef.setInput('canRename', false);
      await fixture.whenStable();

      expect(titleButton()).toBeNull();
      expect(el().querySelector('.board-title')?.textContent).toContain('Q3 planning');
    });

    it('shows the name as a button that is labelled for screen readers', () => {
      expect(titleButton()?.textContent).toContain('Q3 planning');
      expect(titleButton()?.getAttribute('aria-label')).toBe('Rename the board Q3 planning');
      expect(el().querySelector('h1')?.contains(titleButton())).toBe(true);
    });

    it('turns into a focused field with the name selected when clicked', async () => {
      titleButton()!.click();
      await fixture.whenStable();

      expect(titleButton()).toBeNull();
      expect(field()!.value).toBe('Q3 planning');
      expect(field()!.maxLength).toBe(120);
      expect(document.activeElement).toBe(field());
    });

    it('saves the trimmed name on Enter', async () => {
      const names = emitted();
      titleButton()!.click();
      await fixture.whenStable();

      await type('  Q4 planning  ');
      await press('Enter');

      expect(names).toEqual(['Q4 planning']);
      expect(field()).toBeNull();
    });

    it('saves on blur', async () => {
      const names = emitted();
      titleButton()!.click();
      await fixture.whenStable();

      await type('Q4 planning');
      field()!.dispatchEvent(new Event('blur'));
      await fixture.whenStable();

      expect(names).toEqual(['Q4 planning']);
    });

    it('drops the change on Escape, even though closing the field can blur it', async () => {
      const names = emitted();
      titleButton()!.click();
      await fixture.whenStable();
      const input = field()!;

      await type('Something else');
      await press('Escape');
      input.dispatchEvent(new Event('blur'));
      await fixture.whenStable();

      expect(names).toEqual([]);
      expect(titleButton()?.textContent).toContain('Q3 planning');
    });

    it('does not ask for a save when the name did not change', async () => {
      const names = emitted();
      titleButton()!.click();
      await fixture.whenStable();

      await type('  Q3 planning ');
      await press('Enter');

      expect(names).toEqual([]);
      expect(field()).toBeNull();
    });

    it('refuses an empty name on Enter: the field stays open with a message', async () => {
      const names = emitted();
      titleButton()!.click();
      await fixture.whenStable();

      await type('   ');
      await press('Enter');

      expect(names).toEqual([]);
      expect(field()).not.toBeNull();
      expect(field()!.getAttribute('aria-invalid')).toBe('true');
      expect(el().querySelector('[role="alert"]')?.textContent).toContain('needs a name');

      await type('Back again'); // typing clears the message
      expect(el().querySelector('[role="alert"]')).toBeNull();
    });

    it('treats leaving the field with an empty name as a cancel', async () => {
      const names = emitted();
      titleButton()!.click();
      await fixture.whenStable();

      await type('');
      field()!.dispatchEvent(new Event('blur'));
      await fixture.whenStable();

      expect(names).toEqual([]);
      expect(titleButton()?.textContent).toContain('Q3 planning');
    });
  });
});
