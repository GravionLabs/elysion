import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { InviteLinks } from './invite-links';

const board = '0197a8d2-1c3e-7a10-8000-000000000001';
const url = `/api/boards/${board}/invitations`;
const link = {
  id: 'i1',
  role: 'Viewer',
  expiresAt: '2026-10-20T10:00:00Z',
  maxUses: 5,
  uses: 2,
  createdAt: '2026-10-11T10:00:00Z',
};

describe('InviteLinks', () => {
  let fixture: ComponentFixture<InviteLinks>;
  let http: HttpTestingController;
  const el = () => fixture.nativeElement as HTMLElement;
  const settle = async () => {
    await fixture.whenStable();
    fixture.detectChanges();
  };
  const change = async (selector: string, value: string, event = 'change') => {
    const field = el().querySelector(selector) as HTMLInputElement | HTMLSelectElement;
    field.value = value;
    field.dispatchEvent(new Event(event));
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
      imports: [InviteLinks],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(InviteLinks);
    fixture.componentRef.setInput('boardId', board);
    await settle();
  });

  afterEach(() => http.verify());

  it('lists the active links with role, expiry and uses', async () => {
    expect(el().textContent).toContain('Loading links');
    http.expectOne(url).flush([link]);
    await settle();

    const row = el().querySelector('.link')!;
    expect(row.textContent).toContain('Viewer');
    expect(row.textContent).toContain('used 2 of 5');
    expect(el().textContent).toContain('cannot be shown again');
  });

  it('says when there are none', async () => {
    http.expectOne(url).flush([]);
    await settle();

    expect(el().textContent).toContain('No active links');
  });

  it('makes a link with the chosen role, lifetime and uses, shows it once and lists it', async () => {
    http.expectOne(url).flush([]);
    await settle();
    await change('select:nth-of-type(1)', 'Editor');
    await change('.make label:nth-of-type(2) select', '24');
    await change('input[type="number"]', '3', 'input');
    await submit();

    const request = http.expectOne(url);
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual({ role: 'Editor', expiresInHours: 24, maxUses: 3 });
    request.flush({ ...link, id: 'i2', role: 'Editor', token: 'tok_en-1' });
    await settle();

    const shown = el().querySelector('.created input') as HTMLInputElement;
    expect(shown.value).toBe(`${location.origin}/invite/tok_en-1`);
    expect(el().querySelectorAll('.link').length).toBe(1);
  });

  it('defaults to a Viewer link for 7 days without a limit of uses', async () => {
    http.expectOne(url).flush([]);
    await settle();
    await submit();

    expect(http.expectOne(url).request.body).toEqual({ role: 'Viewer', expiresInHours: 168 });
  });

  it('refuses a number of uses that makes no sense', async () => {
    http.expectOne(url).flush([]);
    await settle();
    await change('input[type="number"]', '0', 'input');
    await submit();

    http.expectNone(url);
    expect(el().querySelector('[role="alert"]')?.textContent).toContain('1 to 1000');
  });

  it("shows the API's message when making a link fails", async () => {
    http.expectOne(url).flush([]);
    await settle();
    await submit();
    http
      .expectOne(url)
      .flush({ message: 'Too many active links.' }, { status: 409, statusText: 'Conflict' });
    await settle();

    expect(el().querySelector('[role="alert"]')?.textContent).toContain('Too many active links.');
  });

  it('copies the link and says so, or tells the person to copy it by hand', async () => {
    http.expectOne(url).flush([]);
    await settle();
    await submit();
    http.expectOne(url).flush({ ...link, token: 'abc' });
    await settle();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });

    (el().querySelector('.created button') as HTMLButtonElement).click();
    await settle();
    expect(writeText).toHaveBeenCalledWith(`${location.origin}/invite/abc`);
    expect(el().querySelector('.created [role="status"]')?.textContent).toContain('Copied');

    writeText.mockRejectedValue(new Error('denied'));
    (el().querySelector('.created button') as HTMLButtonElement).click();
    await settle();
    expect(el().querySelector('.created [role="status"]')?.textContent).toContain(
      'select the link',
    );
  });

  it('revokes a link', async () => {
    http.expectOne(url).flush([link]);
    await settle();

    (el().querySelector('.link .remove') as HTMLButtonElement).click();
    const request = http.expectOne(`${url}/i1`);
    expect(request.request.method).toBe('DELETE');
    request.flush(null);
    await settle();

    expect(el().querySelectorAll('.link').length).toBe(0);
  });

  it('keeps the link and says why when revoking fails', async () => {
    http.expectOne(url).flush([link]);
    await settle();

    (el().querySelector('.link .remove') as HTMLButtonElement).click();
    http.expectOne(`${url}/i1`).flush(null, { status: 500, statusText: 'x' });
    await settle();

    expect(el().querySelectorAll('.link').length).toBe(1);
    expect(el().querySelector('[role="alert"]')?.textContent).toContain('could not be revoked');
  });
});
