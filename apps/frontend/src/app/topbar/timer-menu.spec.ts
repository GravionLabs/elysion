import { ComponentFixture, TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TimerState } from '../board/canvas-element';
import {
  END_DISPLAY_MS,
  MUTED_STORAGE_KEY,
  TAKEOVER_GRACE_MS,
  TIMER_PRESETS,
  TimerMenu,
} from './timer-menu';
import { TimerChime } from './timer-chime';

const T0 = new Date('2026-10-07T10:00:00Z').getTime();
const MIN = 60_000;
const ADA = { id: 'u-ada', name: 'Ada' };

const running = (durationMs: number, startedAt = T0, startedBy = ADA): TimerState => ({
  durationMs,
  startedAt,
  pausedAt: null,
  remainingAtPauseMs: null,
  startedBy,
});

describe('TimerMenu', () => {
  let fixture: ComponentFixture<TimerMenu>;
  let play: ReturnType<typeof vi.fn>;
  const el = () => fixture.nativeElement as HTMLElement;
  const chip = () => el().querySelector('[role="timer"]');
  const clock = () => el().querySelector('.clock')?.textContent?.trim();
  const button = (label: string) =>
    el().querySelector(`button[aria-label="${label}"]`) as HTMLButtonElement | null;
  const events = { start: [] as number[], pause: 0, resume: 0, extend: [] as number[], stop: 0 };

  /** Moves the clock and lets the component see it. */
  const advance = (ms: number) => {
    vi.advanceTimersByTime(ms);
    fixture.detectChanges();
  };
  const set = (
    inputs: Partial<{ timer: TimerState | null; canControl: boolean; userId: string | null }>,
  ) => {
    for (const [name, value] of Object.entries(inputs)) fixture.componentRef.setInput(name, value);
    fixture.detectChanges();
  };

  beforeEach(() => {
    vi.useFakeTimers({ now: T0 });
    localStorage.clear();
    play = vi.fn();
    TestBed.configureTestingModule({
      imports: [TimerMenu],
      providers: [{ provide: TimerChime, useValue: { play } }],
    });
    fixture = TestBed.createComponent(TimerMenu);
    events.start = [];
    events.pause = 0;
    events.resume = 0;
    events.extend = [];
    events.stop = 0;
    const c = fixture.componentInstance;
    c.startRequested.subscribe((ms) => events.start.push(ms));
    c.pauseRequested.subscribe(() => (events.pause += 1));
    c.resumeRequested.subscribe(() => (events.resume += 1));
    c.extendRequested.subscribe((ms) => events.extend.push(ms));
    c.stopRequested.subscribe(() => (events.stop += 1));
    fixture.detectChanges();
  });

  afterEach(() => {
    vi.useRealTimers();
    localStorage.clear();
  });

  describe('without a timer', () => {
    it('shows editors and owners a Timer button and viewers nothing', () => {
      set({ canControl: true });
      expect(el().querySelector('.menu-button')?.textContent).toContain('Timer');

      set({ canControl: false });
      expect(el().querySelector('.menu-button')).toBeNull();
      expect(chip()).toBeNull();
    });

    it('opens a menu with the presets and a minutes field, five minutes preselected', () => {
      set({ canControl: true });
      (el().querySelector('.menu-button') as HTMLElement).click();
      fixture.detectChanges();

      const presets = [...el().querySelectorAll('.preset')].map((p) => p.textContent?.trim());
      expect(presets).toEqual(TIMER_PRESETS.map((m) => `${m} min`));
      expect((el().querySelector('#timer-minutes') as HTMLInputElement).value).toBe('5');
      expect(el().querySelector('.preset.selected')?.textContent).toContain('5 min');
    });

    it('starts the chosen preset for everybody and closes the menu', () => {
      set({ canControl: true });
      (el().querySelector('.menu-button') as HTMLElement).click();
      fixture.detectChanges();
      (el().querySelectorAll('.preset')[3] as HTMLElement).click(); // 10 min
      fixture.detectChanges();
      (el().querySelector('.start') as HTMLElement).click(); // a submit button: the form is submitted
      fixture.detectChanges();

      expect(events.start).toEqual([10 * MIN]);
      expect(el().querySelector('.menu')).toBeNull();
    });

    it('takes any number of minutes in the field, also with a comma', () => {
      set({ canControl: true });
      (el().querySelector('.menu-button') as HTMLElement).click();
      fixture.detectChanges();
      const input = el().querySelector('#timer-minutes') as HTMLInputElement;
      input.value = '7,5';
      input.dispatchEvent(new Event('input'));
      (el().querySelector('form') as HTMLFormElement).dispatchEvent(new Event('submit'));

      expect(events.start).toEqual([450_000]);
    });

    it.each(['', 'abc', '0', '-3', '1441'])(
      'refuses "%s" minutes with a message and starts nothing',
      (text) => {
        set({ canControl: true });
        (el().querySelector('.menu-button') as HTMLElement).click();
        fixture.detectChanges();
        const input = el().querySelector('#timer-minutes') as HTMLInputElement;
        input.value = text;
        input.dispatchEvent(new Event('input'));
        (el().querySelector('form') as HTMLFormElement).dispatchEvent(new Event('submit'));
        fixture.detectChanges();

        expect(events.start).toEqual([]);
        expect(el().querySelector('[role="alert"]')?.textContent).toContain('between 1 and 1440');
        expect(el().querySelector('.menu')).not.toBeNull();
      },
    );

    it('closes on Escape and on a click elsewhere', () => {
      set({ canControl: true });
      const open = () => {
        (el().querySelector('.menu-button') as HTMLElement).click();
        fixture.detectChanges();
      };
      open();
      el().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      fixture.detectChanges();
      expect(el().querySelector('.menu')).toBeNull();

      open();
      document.body.click();
      fixture.detectChanges();
      expect(el().querySelector('.menu')).toBeNull();
    });
  });

  describe('the countdown chip', () => {
    it('shows the time left as mm:ss, for everybody, with who started it as the tooltip', () => {
      set({ timer: running(5 * MIN), canControl: false });

      expect(clock()).toBe('05:00');
      expect(chip()?.getAttribute('aria-live')).toBe('off');
      expect(chip()?.getAttribute('title')).toBe('Started by Ada');
    });

    it('counts down every second from the local clock', () => {
      set({ timer: running(5 * MIN), canControl: false });

      advance(1000);
      expect(clock()).toBe('04:59');
      advance(59_000);
      expect(clock()).toBe('04:00');
    });

    it('shows hours from an hour on', () => {
      set({ timer: running(90 * MIN), canControl: false });

      expect(clock()).toBe('1:30:00');
    });

    it('shows the right time for somebody who joins while it runs, and after a reload', () => {
      vi.setSystemTime(T0 + 2 * MIN + 30_000);
      set({ timer: running(5 * MIN, T0), canControl: false });

      expect(clock()).toBe('02:30');
    });

    it('stands still while paused, with what was left', () => {
      set({
        timer: { ...running(5 * MIN), pausedAt: T0 + MIN, remainingAtPauseMs: 4 * MIN },
        canControl: false,
      });

      expect(clock()).toBe('04:00');
      expect(el().querySelector('.state')?.textContent).toBe('paused');
      advance(30_000);
      expect(clock()).toBe('04:00');
    });

    it('follows a new state: an extension adds time at once', () => {
      set({ timer: running(5 * MIN), canControl: false });
      advance(60_000);
      expect(clock()).toBe('04:00');

      set({ timer: running(6 * MIN) });

      expect(clock()).toBe('05:00');
    });

    it('goes away when the timer is stopped, and the menu button comes back for those who may write', () => {
      set({ timer: running(MIN), canControl: true });
      expect(chip()).not.toBeNull();

      set({ timer: null });

      expect(chip()).toBeNull();
      expect(el().querySelector('.menu-button')).not.toBeNull();
    });
  });

  describe('the controls', () => {
    it('gives editors and owners pause, +1 min and stop', () => {
      set({ timer: running(5 * MIN), canControl: true });

      button('Pause the timer')!.click();
      button('Add one minute to the timer')!.click();
      button('Stop the timer')!.click();

      expect(events).toMatchObject({ pause: 1, extend: [60_000], stop: 1 });
    });

    it('offers Resume instead of Pause while paused', () => {
      set({
        timer: { ...running(5 * MIN), pausedAt: T0, remainingAtPauseMs: 5 * MIN },
        canControl: true,
      });

      expect(button('Pause the timer')).toBeNull();
      button('Resume the timer')!.click();

      expect(events.resume).toBe(1);
    });

    it('gives viewers the chip and no control, only the mute toggle', () => {
      set({ timer: running(5 * MIN), canControl: false });

      expect(chip()).not.toBeNull();
      for (const label of ['Pause the timer', 'Add one minute to the timer', 'Stop the timer']) {
        expect(button(label)).toBeNull();
      }
      expect(button('Mute the end chime')).not.toBeNull();
    });
  });

  describe('the end', () => {
    const toEnd = (
      timer = running(MIN),
      by: Partial<{ userId: string | null; canControl: boolean }> = {},
    ) => {
      set({ timer, canControl: by.canControl ?? true, userId: by.userId ?? ADA.id });
      advance(MIN + 1000);
    };

    it('turns the chip red at 00:00', () => {
      toEnd();

      expect(clock()).toBe('00:00');
      expect(chip()?.classList).toContain('ended');
    });

    it('plays the chime once, however long the zero stays', () => {
      toEnd();
      advance(2000);
      advance(2000);

      expect(play).toHaveBeenCalledTimes(1);
    });

    it('does not play it when muted, and a mute set earlier is remembered', () => {
      localStorage.setItem(MUTED_STORAGE_KEY, 'true');
      fixture = TestBed.createComponent(TimerMenu);
      toEnd();

      expect(play).not.toHaveBeenCalled();
    });

    it('does not play it for a timer that ended before this client looked', () => {
      vi.setSystemTime(T0 + 10 * MIN);
      set({ timer: running(MIN), canControl: true, userId: ADA.id });
      advance(1000);

      expect(play).not.toHaveBeenCalled();
    });

    it('clears the timer five seconds after the end when this client started it, once', () => {
      toEnd();
      // The end is noticed on the tick after zero; the red 00:00 stays for five seconds from there.
      advance(END_DISPLAY_MS - 1);
      expect(events.stop).toBe(0);

      advance(1);
      expect(events.stop).toBe(1);
      advance(20_000);
      expect(events.stop).toBe(1);
    });

    it("leaves clearing to the starter first: another editor's client waits a few seconds longer", () => {
      toEnd(running(MIN), { userId: 'u-bea' });
      advance(END_DISPLAY_MS);
      expect(events.stop).toBe(0);

      advance(TAKEOVER_GRACE_MS);
      expect(events.stop).toBe(1);
    });

    it('never clears from a viewer, who has no right to write', () => {
      toEnd(running(MIN), { canControl: false, userId: 'u-viewer' });
      advance(60_000);

      expect(events.stop).toBe(0);
      expect(play).toHaveBeenCalledTimes(1); // but a viewer hears the end
    });

    it('does not clear when somebody extended the timer in the meantime', () => {
      toEnd();
      advance(2000);

      set({ timer: running(5 * MIN) });
      advance(60_000);

      expect(events.stop).toBe(0);
      expect(chip()?.classList).not.toContain('ended');
    });

    it('does not end a paused timer', () => {
      set({
        timer: { ...running(MIN), pausedAt: T0 + 100, remainingAtPauseMs: 59_900 },
        canControl: true,
        userId: ADA.id,
      });
      advance(10 * MIN);

      expect(chip()?.classList).not.toContain('ended');
      expect(play).not.toHaveBeenCalled();
      expect(events.stop).toBe(0);
    });
  });

  describe('the end chime toggle', () => {
    it('mutes and unmutes, and keeps the choice per browser', () => {
      set({ timer: running(5 * MIN), canControl: true });

      button('Mute the end chime')!.click();
      fixture.detectChanges();
      expect(localStorage.getItem(MUTED_STORAGE_KEY)).toBe('true');
      expect(button('Turn the end chime on')?.getAttribute('aria-pressed')).toBe('true');

      button('Turn the end chime on')!.click();
      fixture.detectChanges();
      expect(localStorage.getItem(MUTED_STORAGE_KEY)).toBe('false');
    });

    it('is also in the menu, before a timer runs', () => {
      set({ canControl: true });
      (el().querySelector('.menu-button') as HTMLElement).click();
      fixture.detectChanges();

      (el().querySelector('.mute-option input') as HTMLInputElement).click();

      expect(localStorage.getItem(MUTED_STORAGE_KEY)).toBe('true');
    });

    it('still works when the browser will not store it', () => {
      const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new Error('blocked');
      });
      set({ timer: running(5 * MIN), canControl: true });

      expect(() => button('Mute the end chime')!.click()).not.toThrow();
      fixture.detectChanges();
      expect(button('Turn the end chime on')).not.toBeNull();
      setItem.mockRestore();
    });
  });
});
