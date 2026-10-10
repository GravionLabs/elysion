import { ComponentFixture, TestBed } from '@angular/core/testing';
import { LanguageService } from '../shared/language';
import { UserMenu } from './user-menu';

describe('UserMenu', () => {
  let fixture: ComponentFixture<UserMenu>;
  const el = () => fixture.nativeElement as HTMLElement;
  const button = () => el().querySelector('.user-button') as HTMLButtonElement;
  const menu = () => el().querySelector('[role="menu"]');
  let logouts: number;
  const use = vi.fn();

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [UserMenu],
      providers: [{ provide: LanguageService, useValue: { current: 'en', use } }],
    }).compileComponents();
    fixture = TestBed.createComponent(UserMenu);
    fixture.componentRef.setInput('user', {
      id: 'kc-1',
      name: 'ada lovelace',
      email: 'ada@example.com',
      color: '#14b8a6',
    });
    logouts = 0;
    fixture.componentInstance.logoutRequested.subscribe(() => (logouts += 1));
    await fixture.whenStable();
  });

  it("shows the name and an avatar with the initials in the user's color", () => {
    expect(el().querySelector('.user-name')?.textContent).toContain('ada lovelace');
    const avatar = el().querySelector('.user-avatar') as HTMLElement;
    expect(avatar.textContent?.trim()).toBe('AL');
    expect(avatar.style.backgroundColor).toBe('rgb(20, 184, 166)');
  });

  it('is closed at first and opens with the button, showing the email and Log out', async () => {
    expect(menu()).toBeNull();
    expect(button().getAttribute('aria-expanded')).toBe('false');

    button().click();
    await fixture.whenStable();

    expect(menu()).toBeTruthy();
    expect(button().getAttribute('aria-expanded')).toBe('true');
    expect(menu()?.textContent).toContain('ada@example.com');
    expect(menu()?.textContent).toContain('Log out');
  });

  it('asks to log out and closes', async () => {
    button().click();
    await fixture.whenStable();

    (el().querySelector('[role="menuitem"]') as HTMLButtonElement).click();
    await fixture.whenStable();

    expect(logouts).toBe(1);
    expect(menu()).toBeNull();
  });

  it('closes on Escape and on a click outside, not on a click inside', async () => {
    button().click();
    await fixture.whenStable();
    menu()!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await fixture.whenStable();
    expect(menu()).toBeTruthy();

    document.body.click();
    await fixture.whenStable();
    expect(menu()).toBeNull();

    button().click();
    await fixture.whenStable();
    el().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await fixture.whenStable();
    expect(menu()).toBeNull();
  });

  it('leaves out the email line when there is none', async () => {
    fixture.componentRef.setInput('user', {
      id: 'kc-1',
      name: 'ada',
      email: null,
      color: '#14b8a6',
    });
    button().click();
    await fixture.whenStable();

    expect(el().querySelector('.menu-email')).toBeNull();
  });

  it('uses a question mark when the name has no letters to take', async () => {
    fixture.componentRef.setInput('user', {
      id: 'kc-1',
      name: '  ',
      email: null,
      color: '#14b8a6',
    });
    await fixture.whenStable();

    expect(el().querySelector('.user-avatar')?.textContent?.trim()).toBe('?');
  });

  it('offers the languages, marks the one in use and switches to the other', async () => {
    button().click();
    await fixture.whenStable();

    const items = [...el().querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]')];
    expect(items.map((item) => item.textContent?.trim())).toEqual(['English', 'Deutsch']);
    expect(items.map((item) => item.getAttribute('aria-checked'))).toEqual(['true', 'false']);

    items[1].click();
    expect(use).toHaveBeenCalledWith('de');
  });
});
