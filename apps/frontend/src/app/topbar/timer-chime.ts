import { Injectable } from '@angular/core';

/**
 * The short sound at the end of the shared timer: two tones made with the Web Audio API (no audio file, no fetch).
 * Browsers refuse sound until the user has interacted with the page; a client that never did gets no sound and no
 * error. Kept in a service so tests can replace it.
 */
@Injectable({ providedIn: 'root' })
export class TimerChime {
  play(): void {
    try {
      const AudioContextClass: typeof AudioContext | undefined = globalThis.AudioContext;
      if (!AudioContextClass) return;
      const context = new AudioContextClass();
      // A context made before any interaction starts suspended: resuming it then is refused, which is fine.
      void context.resume().catch(() => undefined);
      const start = context.currentTime;
      [880, 1175].forEach((frequency, index) => {
        const oscillator = context.createOscillator();
        const gain = context.createGain();
        const at = start + index * 0.3;
        oscillator.type = 'sine';
        oscillator.frequency.value = frequency;
        gain.gain.setValueAtTime(0.0001, at);
        gain.gain.exponentialRampToValueAtTime(0.25, at + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.28);
        oscillator.connect(gain).connect(context.destination);
        oscillator.start(at);
        oscillator.stop(at + 0.3);
      });
      globalThis.setTimeout(() => void context.close().catch(() => undefined), 900);
    } catch {
      // No sound is not an error: the timer is on screen.
    }
  }
}
