import { signal } from '@angular/core';
import { type SessionUser, SessionService } from './session.service';

/** A stand-in for {@link SessionService} in tests: no login library, no Keycloak. */
export class FakeSession {
  readonly user = signal<SessionUser | null>(null);
  logoutCalls = 0;
  restartCalls = 0;

  logout(): void {
    this.logoutCalls += 1;
  }

  restartLogin(): void {
    this.restartCalls += 1;
  }
}

export const FAKE_USER: SessionUser = {
  id: 'kc-sub-1',
  name: 'ada',
  email: 'ada@example.com',
  color: '#14b8a6',
};

/** Provides the fake in place of the real service; `user` is who is signed in (nobody when `null`). */
export function provideFakeSession(user: SessionUser | null = FAKE_USER) {
  const fake = new FakeSession();
  fake.user.set(user);
  return { provide: SessionService, useValue: fake };
}
