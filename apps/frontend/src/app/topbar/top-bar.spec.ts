import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { DEFAULT_EXPORT_SETTINGS } from './export-settings';
import { TopBar } from './top-bar';

describe('TopBar', () => {
  let fixture: ComponentFixture<TopBar>;
  const el = () => fixture.nativeElement as HTMLElement;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [TopBar],
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
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

  it('says Offline, not Connecting…, while it tries again after an outage, and explains the status in a tooltip', async () => {
    fixture.componentRef.setInput('status', 'connecting');
    fixture.componentRef.setInput('offline', true);
    await fixture.whenStable();

    const chip = el().querySelector('[role="status"]') as HTMLElement;
    expect(chip.textContent).toContain('Offline');
    expect(chip.title).toContain('kept on this device');

    fixture.componentRef.setInput('status', 'connected');
    await fixture.whenStable();
    expect(chip.textContent).toContain('Connected');
    expect(chip.title).toContain('reach everyone');
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

    expect(requests).toEqual([
      { format: 'png', selectionOnly: false, settings: DEFAULT_EXPORT_SETTINGS },
    ]);
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
  describe('presence', () => {
    const users = [
      { id: 'a', name: 'Ada Lovelace', color: '#14b8a6' },
      { id: 'b', name: 'guest 4821', color: '#3b82f6' },
    ];
    const presence = () => el().querySelector('.presence');
    const avatars = () => [...el().querySelectorAll('.presence .avatar')] as HTMLElement[];

    it('shows nothing while nobody else is on the board', () => {
      expect(presence()).toBeNull();
    });

    it('shows an avatar with initials and the cursor color for everyone else', async () => {
      fixture.componentRef.setInput('users', users);
      await fixture.whenStable();

      expect(avatars().map((avatar) => avatar.textContent?.trim())).toEqual(['AL', 'G4']);
      expect(avatars()[0].style.backgroundColor).toBe('rgb(20, 184, 166)');
    });

    it('names them for assistive technology and as a tooltip', async () => {
      fixture.componentRef.setInput('users', users);
      await fixture.whenStable();

      expect(presence()?.getAttribute('aria-label')).toBe(
        'On this board: Ada Lovelace, guest 4821',
      );
      fixture.componentRef.setInput('users', [users[0]]);
      await fixture.whenStable();
      expect(presence()?.getAttribute('title')).toBe('Ada Lovelace is on this board');
    });

    it('shows three avatars at most and counts the rest', async () => {
      const many = Array.from({ length: 5 }, (_, i) => ({
        id: `u${i}`,
        name: `User ${i}`,
        color: '#3b82f6',
      }));
      fixture.componentRef.setInput('users', many);
      await fixture.whenStable();

      expect(avatars().map((avatar) => avatar.textContent?.trim())).toEqual([
        'U0',
        'U1',
        'U2',
        '+2',
      ]);
    });

    it('makes the avatars buttons that say "Follow <name>" and ask to follow that person', async () => {
      const followed: string[] = [];
      fixture.componentInstance.followRequested.subscribe((id) => followed.push(id));
      fixture.componentRef.setInput('users', users);
      await fixture.whenStable();

      expect(avatars().map((avatar) => avatar.tagName)).toEqual(['BUTTON', 'BUTTON']);
      expect(avatars().map((avatar) => avatar.getAttribute('aria-label'))).toEqual([
        'Follow Ada Lovelace',
        'Follow guest 4821',
      ]);
      avatars()[1].click();
      expect(followed).toEqual(['b']);
    });

    it('marks the avatar of the person who is followed as pressed', async () => {
      fixture.componentRef.setInput('users', users);
      fixture.componentRef.setInput('followState', {
        following: { id: 'a', name: 'Ada Lovelace', color: '#14b8a6', reason: 'person' },
        presenter: null,
        steppedOut: false,
      });
      await fixture.whenStable();

      expect(avatars().map((avatar) => avatar.getAttribute('aria-pressed'))).toEqual([
        'true',
        'false',
      ]);
    });

    it('falls back to a question mark for a name without letters to take', async () => {
      fixture.componentRef.setInput('users', [{ id: 'x', name: '  ', color: '#3b82f6' }]);
      await fixture.whenStable();

      expect(avatars()[0].textContent?.trim()).toBe('?');
    });
  });

  describe('presenting (#848)', () => {
    const menu = () => el().querySelector('app-present-menu') as HTMLElement | null;
    const trigger = () => menu()?.querySelector('button') as HTMLButtonElement;
    const item = (label: string) =>
      [...(menu()?.querySelectorAll('[role="menuitem"]') ?? [])].find((button) =>
        button.textContent?.includes(label),
      ) as HTMLButtonElement;

    it('has a Present button after Voting for those who may write, and none for a viewer', async () => {
      expect(trigger().textContent).toContain('Present');
      expect(menu()?.previousElementSibling?.tagName).toBe('APP-VOTING-MENU');

      fixture.componentRef.setInput('readOnly', true);
      await fixture.whenStable();

      expect(menu()).toBeNull();
    });

    it('asks to start presenting, to stop and to bring everyone', async () => {
      const events: string[] = [];
      const bar = fixture.componentInstance;
      bar.presentStart.subscribe(() => events.push('start'));
      bar.presentStop.subscribe(() => events.push('stop'));
      bar.presentSummon.subscribe(() => events.push('summon'));

      trigger().click();
      await fixture.whenStable();
      item('Start presenting').click();
      trigger().click();
      await fixture.whenStable();
      item('Bring everyone to me').click();
      fixture.componentRef.setInput('followState', {
        following: null,
        presenter: { id: 'me', name: 'Me', color: '#14b8a6', me: true },
        steppedOut: false,
      });
      await fixture.whenStable();
      trigger().click();
      await fixture.whenStable();
      item('Stop presenting').click();

      expect(events).toEqual(['start', 'summon', 'stop']);
    });

    describe('while somebody else presents', () => {
      const others = { id: 'x', name: 'Xi', color: '#14b8a6', me: false };
      const setup = async (canShare: boolean) => {
        fixture.componentRef.setInput('canShare', canShare);
        fixture.componentRef.setInput('followState', {
          following: null,
          presenter: others,
          steppedOut: false,
        });
        await fixture.whenStable();
        trigger().click();
        await fixture.whenStable();
      };

      it('lets an owner stop it', async () => {
        const events: string[] = [];
        fixture.componentInstance.presentStop.subscribe(() => events.push('stop'));
        await setup(true);

        expect(item('Start presenting')).toBeUndefined();
        item('Stop presenting').click();

        expect(events).toEqual(['stop']);
      });

      it('offers an editor who is not the presenter no Stop entry', async () => {
        await setup(false);

        expect(item('Stop presenting')).toBeUndefined();
      });
    });
  });

  describe('the signed-in user', () => {
    const user = { id: 'kc-1', name: 'ada', email: 'ada@example.com', color: '#14b8a6' };

    it('shows the user menu for a signed-in user, and nothing without one', async () => {
      expect(el().querySelector('app-user-menu')).toBeNull();

      fixture.componentRef.setInput('user', user);
      await fixture.whenStable();

      expect(el().querySelector('app-user-menu .user-name')?.textContent).toContain('ada');
    });

    it('passes Log out on', async () => {
      let logouts = 0;
      fixture.componentInstance.logoutRequested.subscribe(() => (logouts += 1));
      fixture.componentRef.setInput('user', user);
      await fixture.whenStable();

      (el().querySelector('.user-button') as HTMLButtonElement).click();
      await fixture.whenStable();
      (
        [...el().querySelectorAll('[role="menuitem"]')].find(
          (item) => item.textContent?.trim() === 'Log out',
        ) as HTMLButtonElement
      ).click();

      expect(logouts).toBe(1);
    });
  });

  describe('sharing and read-only', () => {
    it('shows Share only to somebody who may share, and says so when it is pressed', async () => {
      expect(el().querySelector('.share-button')).toBeNull();

      fixture.componentRef.setInput('canShare', true);
      await fixture.whenStable();
      let shares = 0;
      fixture.componentInstance.shareRequested.subscribe(() => (shares += 1));
      (el().querySelector('.share-button') as HTMLButtonElement).click();

      expect(shares).toBe(1);
    });

    it('shows Import and Library to an editor', () => {
      expect(el().querySelector('.import-button')).toBeTruthy();
      expect(el().querySelector('.library-toggle')).toBeTruthy();
    });

    it('shows Templates to an editor and hides it from a viewer, who cannot change the board', async () => {
      expect(el().querySelector('app-template-menu')).toBeTruthy();

      fixture.componentRef.setInput('readOnly', true);
      await fixture.whenStable();

      expect(el().querySelector('app-template-menu')).toBeNull();
    });

    it('hides Import and Library from a viewer, who cannot change the board, but keeps Export', async () => {
      fixture.componentRef.setInput('readOnly', true);
      await fixture.whenStable();

      expect(el().querySelector('.import-button')).toBeNull();
      expect(el().querySelector('.library-toggle')).toBeNull();
      expect(el().querySelector('app-export-menu')).toBeTruthy();
    });
  });
});
