import { Injectable } from '@angular/core';
import { AbstractSecurityStorage } from 'angular-auth-oidc-client';

/**
 * Fields of the library's state that hold a token or are derived from one. The library keeps everything of a
 * configuration in **one JSON object** under one key (the configuration id), so the split has to happen inside
 * that object.
 */
const TOKEN_FIELDS = [
  'authnResult', // the token response: access, ID and refresh token
  'authzData', // the access token
  'userData',
  'access_token_expires_at',
  'reusable_refresh_token',
  'session_state',
] as const;

type Fields = Record<string, unknown>;

/**
 * Where the login library keeps its state: **tokens only in memory**, the rest in `sessionStorage` (ADR 0016).
 *
 * A script on the page (an XSS) can read `sessionStorage` and `localStorage`, and the library defaults to
 * `sessionStorage` for the tokens. In memory, a stolen page cannot take a token away to use elsewhere. The cost is that
 * a reload loses the tokens; the next navigation logs in again, and because the identity provider still has its own
 * session, that is a redirect there and back without a form.
 *
 * What cannot be in memory is the state of a login that is under way (`codeVerifier`, state, nonce): the browser
 * leaves the page for the identity provider and comes back, which empties memory. That state is short-lived and
 * contains no token; it stays in `sessionStorage`, which is per tab.
 */
@Injectable()
export class TokenSafeStorage implements AbstractSecurityStorage {
  /** The token part of what was written, per key. */
  readonly #tokens = new Map<string, Fields>();

  read(key: string): string | null {
    const flow = this.#withoutTokens(key, parse(readSession(key)));
    const tokens = this.#tokens.get(key);
    if ((flow === null || Object.keys(flow).length === 0) && tokens === undefined) {
      return null;
    }
    if (tokens !== undefined && '__raw' in tokens) {
      return tokens['__raw'] as string;
    }
    return JSON.stringify({ ...flow, ...tokens });
  }

  /**
   * A token in `sessionStorage` is a leftover (an earlier version of the app, or another script, wrote it there):
   * it is removed on sight instead of being used or left for anyone to read.
   */
  #withoutTokens(key: string, flow: Fields | null): Fields | null {
    if (flow === null || !Object.keys(flow).some(isTokenField)) {
      return flow;
    }
    const clean: Fields = Object.fromEntries(
      Object.entries(flow).filter(([name]) => !isTokenField(name)),
    );
    if (Object.keys(clean).length > 0) {
      writeSession(key, JSON.stringify(clean));
    } else {
      removeSession(key);
    }
    return clean;
  }

  write(key: string, value: string): void {
    const fields = parse(value);
    if (fields === null) {
      // Not an object we know the shape of: it could hold anything, so it stays out of the page storage.
      this.#tokens.set(key, { __raw: value });
      return;
    }
    const tokens: Fields = {};
    const flow: Fields = {};
    for (const [name, field] of Object.entries(fields)) {
      (isTokenField(name) ? tokens : flow)[name] = field;
    }
    if (Object.keys(tokens).length > 0) {
      this.#tokens.set(key, tokens);
    } else {
      this.#tokens.delete(key);
    }
    if (Object.keys(flow).length > 0) {
      writeSession(key, JSON.stringify(flow));
    } else {
      removeSession(key);
    }
  }

  remove(key: string): void {
    this.#tokens.delete(key);
    removeSession(key);
  }

  clear(): void {
    this.#tokens.clear();
    try {
      sessionStorage.clear();
    } catch {
      // storage blocked: nothing was stored
    }
  }
}

function isTokenField(name: string): boolean {
  return (TOKEN_FIELDS as readonly string[]).includes(name);
}

function parse(text: string | null): Fields | null {
  if (text === null) {
    return null;
  }
  try {
    const value: unknown = JSON.parse(text);
    return typeof value === 'object' && value !== null && !Array.isArray(value)
      ? (value as Fields)
      : null;
  } catch {
    return null;
  }
}

function readSession(key: string): string | null {
  try {
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeSession(key: string, value: string): void {
  try {
    sessionStorage.setItem(key, value);
  } catch {
    // storage blocked (a private window, a full quota): a login under way then fails visibly instead of crashing
  }
}

function removeSession(key: string): void {
  try {
    sessionStorage.removeItem(key);
  } catch {
    // storage blocked: nothing was stored
  }
}
