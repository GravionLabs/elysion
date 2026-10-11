import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import type { AuditEntry } from '../audit/audit';
import type { Page } from './admin-api';
import { AdminAudit, nextDay } from './admin-audit';

const entry = (n: number): AuditEntry => ({
  id: `e${n}`,
  at: '2026-10-05T12:00:00Z',
  action: 'member.added',
  subjectType: 'board',
  subjectId: `b${n}`,
  subjectName: `Board ${n}`,
  actor: { id: `u${n}`, displayName: `Ada ${n}` },
  target: { id: 'u9', displayName: 'Bob' },
  details: { role: 'Viewer' },
  requestId: null,
});

const page = (items: AuditEntry[], total = items.length, number = 1): Page<AuditEntry> => ({
  items,
  total,
  page: number,
  pageSize: 25,
});

describe('AdminAudit', () => {
  let fixture: ComponentFixture<AdminAudit>;
  let http: HttpTestingController;
  const el = () => fixture.nativeElement as HTMLElement;
  const request = (params: Record<string, string>) =>
    http.expectOne(
      (r) =>
        r.url === '/api/admin/audit' &&
        Object.entries(params).every(([k, v]) => r.params.get(k) === v) &&
        r.params.keys().length === Object.keys(params).length,
    );

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AdminAudit],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(AdminAudit);
    await fixture.whenStable();
  });

  afterEach(() => http.verify());

  it('lists the entries as sentences with when, about what and by whom', async () => {
    request({ page: '1', pageSize: '25' }).flush(page([entry(1), entry(2)]));
    await fixture.whenStable();

    const rows = [...el().querySelectorAll('tbody tr')];
    expect(rows.length).toBe(2);
    const cells = [...rows[0].querySelectorAll('td')].map((c) => c.textContent?.trim());
    expect(cells[1]).toBe('Ada 1 gave Bob the role Viewer');
    expect(cells[2]).toBe('Board: Board 1');
    expect(cells[3]).toBe('Ada 1');
  });

  it('filters by the subject or the person of a row, and takes the filter away again', async () => {
    request({ page: '1', pageSize: '25' }).flush(page([entry(1)]));
    await fixture.whenStable();

    (el().querySelector('tbody tr td:nth-child(3) button') as HTMLButtonElement).click();
    await fixture.whenStable();
    request({ page: '1', pageSize: '25', subject: 'b1' }).flush(page([entry(1)]));
    await fixture.whenStable();
    expect(el().querySelector('.filters .chip')?.textContent).toContain('About: Board 1');

    (el().querySelector('tbody tr td:nth-child(4) button') as HTMLButtonElement).click();
    await fixture.whenStable();
    request({ page: '1', pageSize: '25', subject: 'b1', actor: 'u1' }).flush(page([entry(1)]));
    await fixture.whenStable();
    expect(el().querySelectorAll('.filters .chip').length).toBe(2);

    (el().querySelector('.filters .chip button') as HTMLButtonElement).click();
    await fixture.whenStable();
    request({ page: '1', pageSize: '25', actor: 'u1' }).flush(page([entry(1)]));
  });

  it('filters by dates, the end date being the whole day', async () => {
    request({ page: '1', pageSize: '25' }).flush(page([]));
    await fixture.whenStable();
    expect(el().textContent).toContain('Nothing was recorded for this filter.');

    for (const [name, value] of [
      ['from', '2026-10-01'],
      ['to', '2026-10-31'],
    ]) {
      const input = el().querySelector(`input[name="${name}"]`) as HTMLInputElement;
      input.value = value;
      input.dispatchEvent(new Event('input'));
    }
    el().querySelector('form')!.dispatchEvent(new Event('submit'));
    await fixture.whenStable();

    request({ page: '1', pageSize: '25', from: '2026-10-01', to: '2026-11-01' }).flush(page([]));
  });

  it('says so when it cannot be loaded', async () => {
    request({ page: '1', pageSize: '25' }).flush(null, { status: 500, statusText: 'Error' });
    await fixture.whenStable();
    expect(el().querySelector('[role="alert"]')?.textContent).toContain('could not be loaded');
  });
});

describe('nextDay', () => {
  it('moves over the end of a month and a year', () => {
    expect(nextDay('2026-10-31')).toBe('2026-11-01');
    expect(nextDay('2026-12-31')).toBe('2027-01-01');
  });
});
