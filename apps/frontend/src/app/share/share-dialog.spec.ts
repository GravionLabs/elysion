import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
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
    const input = el().querySelector('input[type="email"]') as HTMLInputElement;
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

  afterEach(() => http.verify());

  const open = async (members = [ada, bea]) => {
    http.expectOne(url).flush(members);
    await settle();
  };

  it('says it is loading until the members arrive, then lists them with name, email and role', async () => {
    expect(el().querySelector('[role="status"]')?.textContent).toContain('Loading');

    await open();

    expect(el().querySelector('[role="status"]')).toBeNull();
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

  it('puts the cursor in the email field', async () => {
    await open();

    expect(document.activeElement).toBe(el().querySelector('input[type="email"]'));
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
      expect((el().querySelector('input[type="email"]') as HTMLInputElement).value).toBe('');
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
      expect((el().querySelector('input[type="email"]') as HTMLInputElement).value).toBe(
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
