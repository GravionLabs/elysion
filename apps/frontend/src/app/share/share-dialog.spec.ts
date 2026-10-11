import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { ShareDialog, describeError } from './share-dialog';
import { HttpErrorResponse } from '@angular/common/http';

const board = '0197a8d2-1c3e-7a10-8000-000000000001';
const ada = { userId: 'u1', displayName: 'Ada', email: 'ada@example.com', role: 'Owner' };
const bea = { userId: 'u2', displayName: 'Bea', email: 'bea@example.com', role: 'Viewer' };
const url = `/api/boards/${board}/members`;

describe('ShareDialog', () => {
  let fixture: ComponentFixture<ShareDialog>;
  let http: HttpTestingController;
  let closed: number;
  const el = () => fixture.nativeElement as HTMLElement;
  const rows = () => [...el().querySelectorAll('.member')] as HTMLElement[];
  const select = (label: string) =>
    el().querySelector(`select[aria-label="${label}"]`) as HTMLSelectElement;
  const button = (label: string) =>
    el().querySelector(`button[aria-label="${label}"]`) as HTMLButtonElement;
  const error = () => el().querySelector('.error')?.textContent?.trim() ?? null;

  const settle = async () => {
    await fixture.whenStable();
    fixture.detectChanges();
  };
  const type = async (value: string) => {
    const input = el().querySelector('app-typeahead input') as HTMLInputElement;
    input.value = value;
    input.dispatchEvent(new Event('input'));
    await settle();
  };
  const submit = async () => {
    (el().querySelector('form') as HTMLFormElement).dispatchEvent(
      new Event('submit', { cancelable: true }),
    );
    await settle();
  };

  beforeEach(async () => {
    TestBed.configureTestingModule({
      imports: [ShareDialog],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(ShareDialog);
    fixture.componentRef.setInput('boardId', board);
    closed = 0;
    fixture.componentInstance.closed.subscribe(() => (closed += 1));
    await settle();
  });

  afterEach(() => {
    http.match((r) => r.url.endsWith('/invitations')).forEach((r) => r.flush([]));
    http.match((r) => r.url === '/api/users').forEach((r) => r.flush([]));
    http.verify();
  });

  /** The links section asks for its own list; these tests are about the members. */
  const answerLinks = () =>
    http.match((r) => r.url.endsWith('/invitations')).forEach((r) => r.flush([]));

  const open = async (members: Array<typeof ada & { isDeactivated?: boolean }> = [ada, bea]) => {
    http.expectOne(url).flush(members);
    answerLinks();
    await settle();
  };

  it('marks a person an administrator deactivated, who stays in the list (#668)', async () => {
    await open([ada, { ...bea, isDeactivated: true }]);

    expect(rows()[0].querySelector('.member-state')).toBeNull();
    expect(rows()[1].querySelector('.member-state')?.textContent).toContain('deactivated');
  });

  it('says it is loading until the members arrive, then lists them with name, email and role', async () => {
    expect(el().querySelector('.note[role="status"]')?.textContent).toContain('Loading');

    await open();

    expect(el().querySelector('.note[role="status"]')).toBeNull();
    expect(rows().map((r) => r.querySelector('.member-name')?.textContent)).toEqual(['Ada', 'Bea']);
    expect(rows()[1].querySelector('.member-email')?.textContent).toBe('bea@example.com');
    expect(select('Role of Ada').value).toBe('Owner');
    expect(select('Role of Bea').value).toBe('Viewer');
  });

  it('is a labelled modal dialog', async () => {
    await open();

    const dialog = el().querySelector('[role="dialog"]')!;
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(el().querySelector(`#${dialog.getAttribute('aria-labelledby')}`)?.textContent).toContain(
      'Share',
    );
  });

  it('puts the cursor in the person field', async () => {
    await open();

    expect(document.activeElement).toBe(el().querySelector('app-typeahead input'));
  });

  it('gives the focus back to the button that opened it when it is gone', async () => {
    await open();
    fixture.destroy();
    const opener = document.body.appendChild(document.createElement('button'));
    opener.focus();

    fixture = TestBed.createComponent(ShareDialog);
    fixture.componentRef.setInput('boardId', board);
    await settle();
    await open();
    expect(document.activeElement).not.toBe(opener);

    fixture.destroy();

    expect(document.activeElement).toBe(opener);
    opener.remove();
  });

  it('shows why the members could not be loaded, and tries again', async () => {
    http.expectOne(url).flush({ message: 'Nope' }, { status: 500, statusText: 'Server Error' });
    await settle();
    expect(error()).toContain('Nope');

    (el().querySelector('.link') as HTMLButtonElement).click();
    await settle();
    expect(http.expectOne(url).request.method).toBe('GET');
  });

  describe('adding a member', () => {
    beforeEach(async () => open());

    it('sends the email with the chosen role, lists the new member and clears the field', async () => {
      await type('  cy@example.com ');
      const roleSelect = select('Role of the new member');
      roleSelect.value = 'Viewer';
      roleSelect.dispatchEvent(new Event('change'));

      await submit();
      const request = http.expectOne(url);
      expect(request.request.method).toBe('POST');
      expect(request.request.body).toEqual({ email: 'cy@example.com', role: 'Viewer' });
      request.flush({ userId: 'u3', displayName: 'Cy', email: 'cy@example.com', role: 'Viewer' });
      await settle();

      expect(rows().map((r) => r.querySelector('.member-name')?.textContent)).toEqual([
        'Ada',
        'Bea',
        'Cy',
      ]);
      expect((el().querySelector('app-typeahead input') as HTMLInputElement).value).toBe('');
      expect(error()).toBeNull();
    });

    it('defaults to Editor', async () => {
      await type('cy@example.com');
      await submit();

      expect(http.expectOne(url).request.body).toEqual({ email: 'cy@example.com', role: 'Editor' });
    });

    it('does not send an empty email, and says what is missing', async () => {
      await submit();

      http.expectNone(url);
      expect(error()).toContain('email');
    });

    it('shows the message of the API next to the form: an unknown email, a duplicate', async () => {
      await type('nobody@example.com');
      await submit();
      http
        .expectOne(url)
        .flush(
          { message: 'No user with this email has logged in to Elysion yet.' },
          { status: 404, statusText: 'Not Found' },
        );
      await settle();

      expect(error()).toBe('No user with this email has logged in to Elysion yet.');
      expect(rows().length).toBe(2);
      expect((el().querySelector('app-typeahead input') as HTMLInputElement).value).toBe(
        'nobody@example.com',
      ); // kept to correct it
    });

    it('clears the message when the user types again', async () => {
      await type('x@y.z');
      await submit();
      http.expectOne(url).flush({ message: 'No.' }, { status: 404, statusText: 'Not Found' });
      await settle();
      expect(error()).toBe('No.');

      await type('x@y.zz');

      expect(error()).toBeNull();
    });

    it('waits for the answer: the controls are disabled meanwhile', async () => {
      await type('cy@example.com');
      await submit();

      expect(el().querySelector<HTMLButtonElement>('button.primary')!.disabled).toBe(true);
      expect(select('Role of Ada').disabled).toBe(true);
      expect(button('Remove Bea').disabled).toBe(true);

      http.expectOne(url).flush({ ...bea, userId: 'u9' });
      await settle();
      expect(button('Remove Bea').disabled).toBe(false);
    });
  });

  describe('changing a role', () => {
    beforeEach(async () => open());

    it('sends the new role and shows the answer', async () => {
      const roleSelect = select('Role of Bea');
      roleSelect.value = 'Editor';
      roleSelect.dispatchEvent(new Event('change'));

      const request = http.expectOne(`${url}/u2`);
      expect(request.request.method).toBe('PATCH');
      expect(request.request.body).toEqual({ role: 'Editor' });
      request.flush({ ...bea, role: 'Editor' });
      await settle();

      expect(select('Role of Bea').value).toBe('Editor');
      expect(error()).toBeNull();
    });

    it('puts the old role back and shows the message when the API refuses (the creator, the last owner)', async () => {
      const roleSelect = select('Role of Ada');
      roleSelect.value = 'Viewer';
      roleSelect.dispatchEvent(new Event('change'));

      http
        .expectOne(`${url}/u1`)
        .flush(
          { message: 'The creator of a board stays its owner.' },
          { status: 409, statusText: 'Conflict' },
        );
      await settle();

      expect(error()).toBe('The creator of a board stays its owner.');
      expect(select('Role of Ada').value).toBe('Owner');
    });
  });

  describe('removing a member', () => {
    beforeEach(async () => open());

    it('removes them from the list once the API has', async () => {
      button('Remove Bea').click();

      const request = http.expectOne(`${url}/u2`);
      expect(request.request.method).toBe('DELETE');
      expect(rows().length).toBe(2); // not before the API says so
      request.flush(null, { status: 204, statusText: 'No Content' });
      await settle();

      expect(rows().map((r) => r.querySelector('.member-name')?.textContent)).toEqual(['Ada']);
    });

    it('keeps them and shows the message when the API refuses', async () => {
      button('Remove Ada').click();

      http
        .expectOne(`${url}/u1`)
        .flush(
          { message: 'A board needs at least one owner.' },
          { status: 409, statusText: 'Conflict' },
        );
      await settle();

      expect(error()).toBe('A board needs at least one owner.');
      expect(rows().length).toBe(2);
    });

    it('says only an owner can do it when the API answers 403 without a message', async () => {
      button('Remove Bea').click();

      http.expectOne(`${url}/u2`).flush(null, { status: 403, statusText: 'Forbidden' });
      await settle();

      expect(error()).toContain('owner');
    });
  });

  describe('closing', () => {
    beforeEach(async () => open());

    it('closes with the X, with Escape and with a click on the backdrop, but not with a click inside', async () => {
      (el().querySelector('.dialog') as HTMLElement).click();
      expect(closed).toBe(0);

      button('Close').click();
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
      (el().querySelector('.backdrop') as HTMLElement).click();

      expect(closed).toBe(3);
    });
  });
});

describe('describeError', () => {
  it('uses the message of the API, else a hint for 403, else the fallback', () => {
    const http = (status: number, body: unknown) => new HttpErrorResponse({ status, error: body });

    expect(describeError(http(409, { message: 'Taken.' }), 'x')).toBe('Taken.');
    expect(describeError(http(403, null), 'x')).toContain('owner');
    expect(describeError(http(500, { message: '  ' }), 'fallback')).toBe('fallback');
    expect(describeError(new Error('boom'), 'fallback')).toBe('fallback');
  });
});

describe('ShareDialog finding people', () => {
  let fixture: ComponentFixture<ShareDialog>;
  let http: HttpTestingController;
  const el = () => fixture.nativeElement as HTMLElement;
  const field = () => el().querySelector('app-typeahead input') as HTMLInputElement;
  const settle = async () => {
    await fixture.whenStable();
    fixture.detectChanges();
  };
  const later = (ms = 300) => new Promise((resolve) => setTimeout(resolve, ms));
  const type = async (text: string) => {
    field().value = text;
    field().dispatchEvent(new Event('input'));
    await later();
    await settle();
  };
  const submit = async () => {
    (el().querySelector('form') as HTMLFormElement).dispatchEvent(
      new Event('submit', { cancelable: true }),
    );
    await settle();
  };
  const cy = { id: 'u3', displayName: 'Cy Beispiel', email: 'cy@example.com' };

  beforeEach(async () => {
    TestBed.configureTestingModule({
      imports: [ShareDialog],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(ShareDialog);
    fixture.componentRef.setInput('boardId', board);
    await settle();
    http.expectOne(url).flush([ada, bea]);
    http.match((r) => r.url.endsWith('/invitations')).forEach((r) => r.flush([]));
    await settle();
  });

  afterEach(() => {
    http.match((r) => r.url.endsWith('/invitations')).forEach((r) => r.flush([]));
    http.verify();
  });

  it('searches while the person types, shows name and email, and adds the one chosen by id', async () => {
    await type('cy');
    const search = http.expectOne((r) => r.url === '/api/users');
    expect(search.request.params.get('query')).toBe('cy');
    search.flush([cy, { id: 'u1', displayName: 'Ada', email: 'ada@example.com' }]);
    await settle();

    const options = [...el().querySelectorAll('[role="option"]')] as HTMLElement[];
    // Ada is a member already: not offered.
    expect(
      options.map((o) => [...o.querySelectorAll('span')].map((x) => x.textContent).join(' ')),
    ).toEqual(['Cy Beispiel cy@example.com']);
    options[0].dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    await settle();
    expect(field().value).toBe('Cy Beispiel');

    await submit();
    const request = http.expectOne(url);
    expect(request.request.body).toEqual({ userId: 'u3', role: 'Editor' });
    request.flush({
      userId: 'u3',
      displayName: 'Cy Beispiel',
      email: 'cy@example.com',
      role: 'Editor',
    });
    await settle();
    expect(el().querySelectorAll('.member')).toHaveLength(3);
    expect(field().value).toBe('');
  });

  it('says nobody was found, and a full email address still works', async () => {
    await type('nobody@example.com');
    http.expectOne((r) => r.url === '/api/users').flush([]);
    await settle();
    expect(el().querySelector('app-typeahead [role="status"]')?.textContent).toContain(
      'A full email address still works',
    );

    await submit();

    expect(http.expectOne(url).request.body).toEqual({
      email: 'nobody@example.com',
      role: 'Editor',
    });
  });

  it('does not add a name that was not chosen from the list', async () => {
    await type('Cy');
    http.expectOne((r) => r.url === '/api/users').flush([cy]);
    await settle();

    await submit();

    http.expectNone(url);
    expect(el().querySelector('.error')?.textContent).toContain('Choose a person from the list');
  });

  it('takes the choice back when the person types again', async () => {
    await type('cy');
    http.expectOne((r) => r.url === '/api/users').flush([cy]);
    await settle();
    (el().querySelector('[role="option"]') as HTMLElement).dispatchEvent(
      new MouseEvent('mousedown', { bubbles: true, cancelable: true }),
    );
    await settle();

    await type('Cy Beispiel x');
    http.expectOne((r) => r.url === '/api/users').flush([]);
    await settle();
    await submit();

    http.expectNone(url);
    expect(el().querySelector('.error')?.textContent).toContain('Choose a person from the list');
  });

  it('keeps the dialog open when Escape closes the list of people', async () => {
    await type('cy');
    http.expectOne((r) => r.url === '/api/users').flush([cy]);
    await settle();
    let closed = 0;
    fixture.componentInstance.closed.subscribe(() => (closed += 1));

    field().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await settle();
    expect(el().querySelector('[role="listbox"]')).toBeNull();
    expect(closed).toBe(0);

    field().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await settle();
    expect(closed).toBe(1);
  });

  it('carries on when the search fails: an email can still be added', async () => {
    await type('cy@example.com');
    http.expectOne((r) => r.url === '/api/users').flush(null, { status: 500, statusText: 'Error' });
    await settle();

    await submit();

    expect(http.expectOne(url).request.body).toEqual({ email: 'cy@example.com', role: 'Editor' });
  });

  it('does not search for fewer than two characters', async () => {
    await type('c');

    http.expectNone((r) => r.url === '/api/users');
  });
});

describe('ShareDialog for a board in a room', () => {
  const room = '0197a8d2-1c3e-7a10-8000-0000000000b1';
  let fixture: ComponentFixture<ShareDialog>;
  let http: HttpTestingController;

  const create = async (roomId: string | null) => {
    TestBed.configureTestingModule({
      imports: [ShareDialog],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    });
    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(ShareDialog);
    fixture.componentRef.setInput('boardId', board);
    fixture.componentRef.setInput('roomId', roomId);
    await fixture.whenStable();
    fixture.detectChanges();
    await Promise.resolve();
  };

  afterEach(() => {
    http.match((r) => r.url.endsWith('/invitations')).forEach((r) => r.flush([]));
    http.verify();
  });

  it('explains the access through the room, with no group controls', async () => {
    await create(room);
    http.expectOne(url).flush([ada]);
    http
      .expectOne('/api/rooms')
      .flush([{ id: room, name: 'Sprint', createdAt: '2026-10-01T00:00:00Z', role: 'Editor' }]);
    http
      .expectOne(`/api/rooms/${room}/groups`)
      .flush([{ groupId: 'g1', name: 'Design', role: 'Editor' }]);
    http
      .expectOne(`/api/rooms/${room}/members`)
      .flush(null, { status: 403, statusText: 'Forbidden' });
    await fixture.whenStable();
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('app-room-access')?.textContent).toContain('Design (Editor)');
    expect(el.querySelector('app-room-groups')).toBeNull();
  });

  it('says nothing about a room for a board that is in none', async () => {
    await create(null);
    http.expectOne(url).flush([ada]);
    await fixture.whenStable();
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('app-room-access')).toBeNull();
    expect(el.querySelector('app-room-groups')).toBeNull();
  });
});

describe('ShareDialog for a room', () => {
  const room = '0197a8d2-1c3e-7a10-8000-0000000000b1';
  const roomUrl = `/api/rooms/${room}/members`;
  let fixture: ComponentFixture<ShareDialog>;
  let http: HttpTestingController;
  const el = () => fixture.nativeElement as HTMLElement;

  beforeEach(async () => {
    TestBed.configureTestingModule({
      imports: [ShareDialog],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(ShareDialog);
    fixture.componentRef.setInput('boardId', room);
    fixture.componentRef.setInput('scope', 'room');
    await fixture.whenStable();
    fixture.detectChanges();
  });

  afterEach(() => {
    http.match((r) => r.url.endsWith('/invitations')).forEach((r) => r.flush([]));
    http.match((r) => r.url.endsWith('/groups')).forEach((r) => r.flush([]));
    http.verify();
  });

  it('asks the room member API and says it is about the room', async () => {
    http.expectOne(roomUrl).flush([ada, bea]);
    await fixture.whenStable();
    fixture.detectChanges();

    expect(el().querySelector('h2')?.textContent).toContain('Share this room');
    expect(el().querySelector('.hint')?.textContent).toContain('every board in the room');
    expect(el().querySelectorAll('.member')).toHaveLength(2);
  });

  it('adds, changes and removes through the room routes', async () => {
    http.expectOne(roomUrl).flush([ada]);
    await fixture.whenStable();
    fixture.detectChanges();

    const input = el().querySelector('app-typeahead input') as HTMLInputElement;
    input.value = 'bea@example.com';
    input.dispatchEvent(new Event('input'));
    (el().querySelector('form') as HTMLFormElement).dispatchEvent(
      new Event('submit', { cancelable: true }),
    );
    const added = http.expectOne(roomUrl);
    expect(added.request.method).toBe('POST');
    added.flush(bea);
    await fixture.whenStable();
    fixture.detectChanges();

    const select = el().querySelector('select[aria-label="Role of Bea"]') as HTMLSelectElement;
    select.value = 'Editor';
    select.dispatchEvent(new Event('change'));
    const changed = http.expectOne(`${roomUrl}/u2`);
    expect(changed.request.method).toBe('PATCH');
    changed.flush({ ...bea, role: 'Editor' });
    await fixture.whenStable();
    fixture.detectChanges();

    (el().querySelector('button[aria-label="Remove Bea"]') as HTMLButtonElement).click();
    const removed = http.expectOne(`${roomUrl}/u2`);
    expect(removed.request.method).toBe('DELETE');
    removed.flush(null, { status: 204, statusText: 'No Content' });
  });

  it('names the room when only an owner may do it', () => {
    http.expectOne(roomUrl).flush([]);
    const forbidden = new HttpErrorResponse({ status: 403 });

    expect(describeError(forbidden, 'x', 'room')).toBe('Only an owner of the room can do this.');
    expect(describeError(forbidden, 'x')).toBe('Only an owner of the board can do this.');
  });
});
