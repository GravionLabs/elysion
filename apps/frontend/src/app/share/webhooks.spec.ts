import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Webhooks } from './webhooks';
import type { CreatedWebhook, Webhook, WebhookDelivery } from './webhooks-api';

const BASE = '/api/boards/b1/webhooks';

const webhook = (n: number, extra: Partial<Webhook> = {}): Webhook => ({
  id: `w${n}`,
  boardId: 'b1',
  url: `https://hooks.example.com/${n}`,
  events: [],
  enabled: true,
  disabledAt: null,
  disabledReason: null,
  createdAt: '2026-10-01T10:00:00Z',
  secretPrefix: 'whsec_abcd',
  ...extra,
});

const delivery = (n: number, extra: Partial<WebhookDelivery> = {}): WebhookDelivery => ({
  id: `d${n}`,
  eventId: `e${n}`,
  eventType: 'board.renamed',
  status: 'succeeded',
  attempts: 1,
  responseStatus: 200,
  durationMs: 42,
  error: null,
  createdAt: '2026-10-01T10:00:00Z',
  lastAttemptAt: '2026-10-01T10:00:01Z',
  nextAttemptAt: null,
  ...extra,
});

const SECRET = `whsec_${'S'.repeat(43)}`;

describe('Webhooks', () => {
  let fixture: ComponentFixture<Webhooks>;
  let http: HttpTestingController;
  const el = () => fixture.nativeElement as HTMLElement;
  const settle = () => fixture.whenStable();
  const items = () => [...el().querySelectorAll('.webhook')];
  const button = (text: string, root: Element = el()) =>
    [...root.querySelectorAll('button')].find((b) => b.textContent?.trim() === text) as
      HTMLButtonElement | undefined;

  const create = async (collapsible: boolean) => {
    fixture = TestBed.createComponent(Webhooks);
    fixture.componentRef.setInput('base', BASE);
    fixture.componentRef.setInput('collapsible', collapsible);
    await settle();
  };

  const openWith = async (list: Webhook[]) => {
    await create(false);
    http.expectOne(BASE).flush(list);
    await settle();
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Webhooks],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('loads nothing while collapsed and the list once it is opened', async () => {
    await create(true);
    http.expectNone(BASE);

    (el().querySelector('.toggle') as HTMLButtonElement).click();
    await settle();
    http.expectOne(BASE).flush([webhook(1, { events: ['board.renamed', 'member.added'] })]);
    await settle();

    expect(items().length).toBe(1);
    expect(items()[0].textContent).toContain('https://hooks.example.com/1');
    expect(items()[0].textContent).toContain('board.renamed, member.added');
    expect(items()[0].textContent).toContain('whsec_abcd…');
  });

  it('says when there are none, and that all events go to a webhook without a choice', async () => {
    await openWith([]);
    expect(el().textContent).toContain('No webhooks yet.');

    http.verify();
  });

  it('adds a webhook with the ticked events and shows its secret once', async () => {
    await openWith([]);
    const url = el().querySelector('input[type="url"]') as HTMLInputElement;
    url.value = ' https://hooks.example.com/new ';
    url.dispatchEvent(new Event('input'));
    const box = [...el().querySelectorAll('.event')]
      .find((label) => label.querySelector('code')?.textContent === 'board.deleted')
      ?.querySelector('input') as HTMLInputElement;
    box.checked = true;
    box.dispatchEvent(new Event('change'));
    await settle();

    button('Add webhook')!.click();
    const request = http.expectOne(BASE);
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual({
      url: 'https://hooks.example.com/new',
      events: ['board.deleted'],
    });
    const created: CreatedWebhook = { ...webhook(9), secret: SECRET };
    request.flush(created);
    await settle();

    expect((el().querySelector('.secret-value') as HTMLInputElement).value).toBe(SECRET);
    expect(items().length).toBe(1);

    button('I have copied it')!.click();
    await settle();
    expect(el().querySelector('.secret-value')).toBeNull();
    expect(el().textContent).not.toContain(SECRET);
  });

  it('shows why a webhook could not be added', async () => {
    await openWith([]);
    const url = el().querySelector('input[type="url"]') as HTMLInputElement;
    url.value = 'http://hooks.example.com';
    url.dispatchEvent(new Event('input'));
    await settle();

    button('Add webhook')!.click();
    http
      .expectOne(BASE)
      .flush(
        { statusCode: 400, message: 'Only https URLs are allowed.' },
        { status: 400, statusText: 'Bad Request' },
      );
    await settle();

    expect(el().querySelector('[role="alert"]')?.textContent).toContain(
      'Only https URLs are allowed.',
    );
  });

  it('sends a test event', async () => {
    await openWith([webhook(1)]);

    button('Send test event')!.click();
    const request = http.expectOne(`${BASE}/w1/test`);
    expect(request.request.method).toBe('POST');
    request.flush(delivery(5, { eventType: 'webhook.test', status: 'pending' }));
    await settle();

    expect(el().textContent).toContain('A test event is on its way.');
  });

  it('turns a webhook off and a disabled one on again, showing why it was turned off', async () => {
    await openWith([
      webhook(1),
      webhook(2, {
        enabled: false,
        disabledAt: '2026-10-02T10:00:00Z',
        disabledReason: 'No delivery succeeded for 24 hours.',
      }),
    ]);
    expect(items()[1].textContent).toContain('No delivery succeeded for 24 hours.');

    button('Turn off', items()[0])!.click();
    const off = http.expectOne(`${BASE}/w1`);
    expect(off.request.method).toBe('PATCH');
    expect(off.request.body).toEqual({ enabled: false });
    off.flush(webhook(1, { enabled: false }));
    await settle();
    expect(button('Turn on', items()[0])).toBeTruthy();

    button('Turn on', items()[1])!.click();
    const on = http.expectOne(`${BASE}/w2`);
    expect(on.request.body).toEqual({ enabled: true });
    on.flush(webhook(2));
    await settle();
    expect(items()[1].textContent).not.toContain('No delivery succeeded');
  });

  it('deletes a webhook', async () => {
    await openWith([webhook(1), webhook(2)]);

    button('Delete', items()[0])!.click();
    const request = http.expectOne(`${BASE}/w1`);
    expect(request.request.method).toBe('DELETE');
    request.flush(null, { status: 204, statusText: 'No Content' });
    await settle();

    expect(items().length).toBe(1);
    expect(items()[0].textContent).toContain('/2');
  });

  it('lists the last deliveries and sends one again', async () => {
    await openWith([webhook(1)]);

    button('Deliveries')!.click();
    http
      .expectOne(`${BASE}/w1/deliveries`)
      .flush([
        delivery(1),
        delivery(2, { status: 'failed', responseStatus: 500, attempts: 3, error: 'HTTP 500' }),
      ]);
    await settle();

    const rows = [...el().querySelectorAll('.deliveries tbody tr')];
    expect(rows.length).toBe(2);
    expect(rows[0].textContent).toContain('delivered');
    expect(rows[0].textContent).toContain('42 ms');
    expect(rows[1].textContent).toContain('failed');
    expect(rows[1].textContent).toContain('HTTP 500');

    button('Send again', rows[1])!.click();
    const request = http.expectOne(`${BASE}/w1/deliveries/d2/redeliver`);
    expect(request.request.method).toBe('POST');
    request.flush(delivery(3, { status: 'pending', responseStatus: null, durationMs: null }));
    await settle();

    expect(el().querySelectorAll('.deliveries tbody tr').length).toBe(3);
  });
});
