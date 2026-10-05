import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TopBar } from './top-bar';

describe('TopBar', () => {
  let fixture: ComponentFixture<TopBar>;
  const el = () => fixture.nativeElement as HTMLElement;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [TopBar] }).compileComponents();
    fixture = TestBed.createComponent(TopBar);
    fixture.componentRef.setInput('boardId', 'team-retro');
    fixture.componentRef.setInput('theme', 'light');
    await fixture.whenStable();
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
});
