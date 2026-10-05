import { TestBed } from '@angular/core/testing';
import { ThemeService } from './theme.service';

describe('ThemeService', () => {
  let systemDark = false;
  let notify: (() => void) | undefined;

  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute('data-theme');
    systemDark = false;
    notify = undefined;
    vi.stubGlobal('matchMedia', () => ({
      get matches() {
        return systemDark;
      },
      addEventListener: (_: string, listener: () => void) => (notify = listener),
      removeEventListener: () => {},
    }));
  });

  afterEach(() => vi.unstubAllGlobals());

  const create = () => TestBed.inject(ThemeService);

  it('follows the system preference when nothing was chosen', () => {
    systemDark = true;

    expect(create().theme()).toBe('dark');
  });

  it('writes the theme to data-theme on the document', () => {
    const service = create();
    TestBed.tick();
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');

    service.set('dark');
    TestBed.tick();
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
  });

  it('keeps an explicit choice over the system preference and across visits', () => {
    systemDark = true;
    create().set('light');
    expect(localStorage.getItem('elysion.theme')).toBe('light');

    TestBed.resetTestingModule();
    expect(create().theme()).toBe('light');
  });

  it('toggles and remembers the result', () => {
    const service = create();

    service.toggle();
    expect(service.theme()).toBe('dark');
    service.toggle();
    expect(service.theme()).toBe('light');
    expect(localStorage.getItem('elysion.theme')).toBe('light');
  });

  it('follows a change of the system preference while nothing was chosen', () => {
    const service = create();
    expect(service.theme()).toBe('light');

    systemDark = true;
    notify?.();

    expect(service.theme()).toBe('dark');
  });

  it('ignores a stored value it does not know', () => {
    localStorage.setItem('elysion.theme', 'sepia');

    expect(create().theme()).toBe('light');
  });

  it('still works when storage is blocked', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    const service = create();

    expect(() => service.toggle()).not.toThrow();
    expect(service.theme()).toBe('dark');
  });
});
