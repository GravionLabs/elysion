import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TokenSafeStorage } from './token-safe-storage';

/** What the login library writes: the whole state of a configuration, as one JSON object under the configuration id. */
const STATE = {
  authnResult: { access_token: 'AT', id_token: 'IT', refresh_token: 'RT' },
  authzData: 'AT',
  userData: { sub: 'kc-1' },
  access_token_expires_at: 1234567890,
  reusable_refresh_token: 'RT',
  session_state: 'ss',
  codeVerifier: 'verifier',
  authStateControl: 'state',
  authNonce: 'nonce',
  storageCodeFlowInProgress: true,
};
const TOKEN_VALUES = ['AT', 'IT', 'RT', 'kc-1'];

describe('TokenSafeStorage', () => {
  let storage: TokenSafeStorage;

  beforeEach(() => {
    sessionStorage.clear();
    localStorage.clear();
    storage = new TokenSafeStorage();
  });

  afterEach(() => vi.restoreAllMocks());

  const allPageStorage = () =>
    JSON.stringify({ ...sessionStorage }) + JSON.stringify({ ...localStorage });

  it('hands back exactly what the library wrote', () => {
    storage.write('0-config', JSON.stringify(STATE));

    expect(JSON.parse(storage.read('0-config')!)).toEqual(STATE);
  });

  it('keeps no token, nor anything derived from one, in the page storage', () => {
    storage.write('0-config', JSON.stringify(STATE));

    for (const secret of TOKEN_VALUES) {
      expect(allPageStorage()).not.toContain(secret);
    }
    expect(localStorage.length).toBe(0);
  });

  it('keeps the state of a login under way in sessionStorage, which survives the redirect', () => {
    storage.write('0-config', JSON.stringify(STATE));

    const kept = JSON.parse(sessionStorage.getItem('0-config')!);

    expect(kept).toEqual({
      codeVerifier: 'verifier',
      authStateControl: 'state',
      authNonce: 'nonce',
      storageCodeFlowInProgress: true,
    });
  });

  it('loses the tokens on a reload but keeps the login state', () => {
    storage.write('0-config', JSON.stringify(STATE));

    const afterReload = new TokenSafeStorage();

    const state = JSON.parse(afterReload.read('0-config')!);
    expect(state.authnResult).toBeUndefined();
    expect(state.userData).toBeUndefined();
    expect(state.codeVerifier).toBe('verifier');
  });

  it('follows later writes: tokens that are gone from the state are gone, also from memory', () => {
    storage.write('0-config', JSON.stringify(STATE));

    storage.write('0-config', JSON.stringify({ codeVerifier: 'v2' }));

    expect(JSON.parse(storage.read('0-config')!)).toEqual({ codeVerifier: 'v2' });
  });

  it('writes only tokens when there is no login state, and leaves nothing in sessionStorage', () => {
    storage.write(
      '0-config',
      JSON.stringify({ authnResult: { access_token: 'AT' }, userData: { sub: 'kc-1' } }),
    );

    expect(sessionStorage.length).toBe(0);
    expect(JSON.parse(storage.read('0-config')!).userData).toEqual({ sub: 'kc-1' });
  });

  it('keeps a value it cannot read as an object out of the page storage', () => {
    storage.write('plain', 'a-token-or-something');

    expect(storage.read('plain')).toBe('a-token-or-something');
    expect(allPageStorage()).not.toContain('a-token-or-something');
  });

  it('answers null for what was never written', () => {
    expect(storage.read('0-config')).toBeNull();
  });

  it('keeps different keys apart', () => {
    storage.write('a', JSON.stringify({ userData: 'A', codeVerifier: 'va' }));
    storage.write('b', JSON.stringify({ userData: 'B', codeVerifier: 'vb' }));

    expect(JSON.parse(storage.read('a')!)).toEqual({ userData: 'A', codeVerifier: 'va' });
    expect(JSON.parse(storage.read('b')!)).toEqual({ userData: 'B', codeVerifier: 'vb' });
  });

  it('removes a key from memory and from sessionStorage', () => {
    storage.write('0-config', JSON.stringify(STATE));

    storage.remove('0-config');

    expect(storage.read('0-config')).toBeNull();
    expect(sessionStorage.length).toBe(0);
  });

  it('clears the tokens and the login state', () => {
    storage.write('0-config', JSON.stringify(STATE));

    storage.clear();

    expect(storage.read('0-config')).toBeNull();
    expect(sessionStorage.length).toBe(0);
  });

  it('does not throw when sessionStorage is blocked: the login state is just not kept, the tokens still work', () => {
    for (const method of ['setItem', 'getItem', 'removeItem', 'clear'] as const) {
      vi.spyOn(Storage.prototype, method).mockImplementation(() => {
        throw new Error('blocked');
      });
    }

    expect(() => storage.write('0-config', JSON.stringify(STATE))).not.toThrow();
    expect(JSON.parse(storage.read('0-config')!).userData).toEqual({ sub: 'kc-1' });
    expect(() => storage.remove('0-config')).not.toThrow();
    expect(() => storage.clear()).not.toThrow();
  });

  it('removes tokens it finds in sessionStorage (a leftover of an earlier version) instead of using or keeping them', () => {
    sessionStorage.setItem(
      '0-config',
      JSON.stringify({ authnResult: { access_token: 'OLD' }, userData: 'x', codeVerifier: 'v' }),
    );

    const read = JSON.parse(storage.read('0-config')!);

    expect(read).toEqual({ codeVerifier: 'v' });
    expect(allPageStorage()).not.toContain('OLD');
    expect(JSON.parse(sessionStorage.getItem('0-config')!)).toEqual({ codeVerifier: 'v' });
  });

  it('drops the whole key when nothing but tokens was there', () => {
    sessionStorage.setItem('0-config', JSON.stringify({ authnResult: { access_token: 'OLD' } }));

    expect(storage.read('0-config')).toBeNull();
    expect(sessionStorage.length).toBe(0);
  });
});
