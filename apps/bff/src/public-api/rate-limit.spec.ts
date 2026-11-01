import { describe, expect, it } from 'vitest';
import { PublicRateLimiter } from './rate-limit.js';

describe('PublicRateLimiter', () => {
  const limiter = (now: () => number, limit = 3, maxKeys?: number) =>
    new PublicRateLimiter({ limit, windowMs: 60_000, now, ...(maxKeys ? { maxKeys } : {}) });

  it('lets the limit through in a minute and refuses the next, counting down what is left', () => {
    const time = 0;
    const rate = limiter(() => time);

    const decisions = [1, 2, 3, 4].map(() => rate.take('token:a'));

    expect(decisions.map((d) => [d.allowed, d.remaining])).toEqual([
      [true, 2],
      [true, 1],
      [true, 0],
      [false, 0],
    ]);
    expect(decisions[0]).toMatchObject({ limit: 3, resetSeconds: 60 });
  });

  it('starts again when the minute is over, and says how long until then', () => {
    let time = 0;
    const rate = limiter(() => time);
    for (let i = 0; i < 4; i += 1) rate.take('token:a');

    time = 45_500;
    expect(rate.take('token:a')).toMatchObject({ allowed: false, resetSeconds: 15 });
    time = 60_000;
    expect(rate.take('token:a')).toMatchObject({ allowed: true, remaining: 2, resetSeconds: 60 });
  });

  it('counts each credential on its own', () => {
    const rate = limiter(() => 0, 1);

    expect(rate.take('token:a').allowed).toBe(true);
    expect(rate.take('token:a').allowed).toBe(false);
    expect(rate.take('user:b').allowed).toBe(true);
  });

  it('forgets the oldest credentials beyond its size, so memory stays bounded', () => {
    const rate = limiter(() => 0, 1, 2);
    rate.take('a');
    rate.take('b');
    rate.take('c'); // a is forgotten

    expect(rate.take('a').allowed).toBe(true);
    expect(rate.take('c').allowed).toBe(false);
  });
});
