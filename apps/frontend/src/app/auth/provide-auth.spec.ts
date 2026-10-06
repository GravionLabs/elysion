import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { AbstractSecurityStorage } from 'angular-auth-oidc-client';
import { describe, expect, it } from 'vitest';
import { appConfig } from '../app.config';
import { provideLogin } from './provide-auth';
import { TokenSafeStorage } from './token-safe-storage';

describe('the login providers', () => {
  it("keep the tokens in memory: the login library's own sessionStorage default does not win", () => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), provideLogin()],
    });

    expect(TestBed.inject(AbstractSecurityStorage)).toBeInstanceOf(TokenSafeStorage);
  });

  it('are what the application uses, with nothing that could replace the storage after them', () => {
    TestBed.configureTestingModule({
      providers: [
        ...appConfig.providers,
        // the real app starts the login and loads its settings; a test only needs the dependency graph
        provideHttpClientTesting(),
      ],
    });

    expect(TestBed.inject(AbstractSecurityStorage)).toBeInstanceOf(TokenSafeStorage);
  });
});
