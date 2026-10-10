import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseEnvelope, rateLimited } from './envelope.js';

describe('parseEnvelope', () => {
  it('reads a good message', () => {
    const envelope = parseEnvelope(JSON.stringify({ from: 'a', type: 'update', data: 'AQID' }), [
      'update',
    ]);

    expect(envelope).toEqual({ from: 'a', type: 'update', data: new Uint8Array([1, 2, 3]) });
  });

  it('needs no type when none is expected', () => {
    expect(parseEnvelope(JSON.stringify({ from: 'a', data: '' }))?.type).toBeUndefined();
  });

  it('refuses a message of more than 24 million characters', () => {
    expect(parseEnvelope('x'.repeat(24 * 1024 * 1024 + 1))).toBeNull();
  });
});

describe('rateLimited', () => {
  afterEach(() => vi.useRealTimers());

  it('lets one call through per interval', () => {
    vi.useFakeTimers();
    const log = vi.fn();
    const limited = rateLimited(log, 10_000);

    limited();
    limited();
    vi.advanceTimersByTime(10_001);
    limited();

    expect(log).toHaveBeenCalledTimes(2);
  });
});
