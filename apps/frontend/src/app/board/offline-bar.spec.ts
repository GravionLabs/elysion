import { ComponentFixture, TestBed } from '@angular/core/testing';
import { OfflineBar } from './offline-bar';

describe('OfflineBar', () => {
  let fixture: ComponentFixture<OfflineBar>;
  const el = () => fixture.nativeElement as HTMLElement;
  const text = () => el().textContent?.replace(/\s+/g, ' ').trim() ?? '';

  const set = async (inputs: Record<string, unknown>) => {
    for (const [name, value] of Object.entries(inputs)) fixture.componentRef.setInput(name, value);
    await fixture.whenStable();
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [OfflineBar] }).compileComponents();
    fixture = TestBed.createComponent(OfflineBar);
    await fixture.whenStable();
  });

  it('is an empty polite live region while the connection is up, so that what appears in it is announced', () => {
    const region = el().querySelector('[role="status"]') as HTMLElement;
    expect(region.getAttribute('aria-live')).toBe('polite');
    expect(text()).toBe('');
  });

  it('says nothing about a short outage', async () => {
    await set({ since: Date.now() - 3000, pending: 2 });
    expect(text()).toBe('');
  });

  it('after 10 seconds says that the work is kept on this device, with the number of changes waiting', async () => {
    await set({ since: Date.now() - 11_000, pending: 3 });

    expect(text()).toContain('Working offline. Your changes are saved on this device');
    expect(text()).toContain('3 changes waiting.');
    expect(el().querySelector('button')).toBeNull();
  });

  it('counts one change in the singular and says nothing of the count when there is none', async () => {
    await set({ since: Date.now() - 11_000, pending: 1 });
    expect(text()).toContain('1 change waiting.');

    await set({ pending: 0 });
    expect(text()).not.toContain('waiting');
  });

  it('after 5 minutes offers a copy of the board', async () => {
    let clicks = 0;
    fixture.componentInstance.downloadCopy.subscribe(() => (clicks += 1));
    await set({ since: Date.now() - 6 * 60_000, pending: 4 });

    const button = el().querySelector('button') as HTMLButtonElement;
    expect(button.textContent).toContain('Download a copy');
    button.click();

    expect(clicks).toBe(1);
  });

  it('says how many changes were sent when the connection is back', async () => {
    await set({ since: null, backSent: 5 });
    expect(text()).toBe('Back online, 5 changes sent.');

    await set({ backSent: 1 });
    expect(text()).toBe('Back online, 1 change sent.');

    await set({ backSent: 0 });
    expect(text()).toBe('Back online.');
  });
});
