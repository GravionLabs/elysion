import { DOCUMENT } from '@angular/common';
import { LOCALE_ID } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { LANGUAGE_COOKIE, LanguageService } from './language';

function setup(localeId: string) {
  const reload = vi.fn();
  const fakeDocument = { cookie: '', location: { reload } };
  TestBed.configureTestingModule({
    providers: [
      { provide: LOCALE_ID, useValue: localeId },
      { provide: DOCUMENT, useValue: fakeDocument },
    ],
  });
  return { service: TestBed.inject(LanguageService), fakeDocument, reload };
}

describe('LanguageService', () => {
  it('is German for a German build and English otherwise', () => {
    expect(setup('de').service.current).toBe('de');
    TestBed.resetTestingModule();
    expect(setup('en-US').service.current).toBe('en');
  });

  it('remembers the other language in the cookie nginx reads and loads the page again', () => {
    const { service, fakeDocument, reload } = setup('en');

    service.use('de');

    expect(fakeDocument.cookie).toContain(`${LANGUAGE_COOKIE}=de`);
    expect(fakeDocument.cookie).toContain('path=/');
    expect(reload).toHaveBeenCalledOnce();
  });

  it('does nothing for the language that is already in use', () => {
    const { service, fakeDocument, reload } = setup('de');

    service.use('de');

    expect(fakeDocument.cookie).toBe('');
    expect(reload).not.toHaveBeenCalled();
  });
});
