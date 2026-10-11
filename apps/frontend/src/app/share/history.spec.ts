import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import type { AuditEntry } from '../audit/audit';
import { ShareHistory } from './history';

const entry = (id: string, action = 'member.added'): AuditEntry => ({
  id,
  at: '2026-10-05T12:00:00Z',
  action,
  subjectType: 'board',
  subjectId: 'b1',
  subjectName: 'Retro',
  actor: { id: 'u1', displayName: 'Ada' },
  target: { id: 'u2', displayName: 'Bob' },
  details: { role: 'Viewer' },
  requestId: null,
});

describe('ShareHistory', () => {
  let fixture: ComponentFixture<ShareHistory>;
  let http: HttpTestingController;
  const el = () => fixture.nativeElement as HTMLElement;
  const toggle = async () => {
    (el().querySelector('.toggle') as HTMLButtonElement).click();
    await fixture.whenStable();
  };

  const create = async (scope: 'board' | 'room' = 'board') => {
    await TestBed.configureTestingModule({
      imports: [ShareHistory],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(ShareHistory);
    fixture.componentRef.setInput('boardId', 'b1');
    fixture.componentRef.setInput('scope', scope);
    await fixture.whenStable();
  };

  afterEach(() => http.verify());

  it('asks for nothing until it is opened, then lists the entries as sentences', async () => {
    await create();
    http.expectNone('/api/boards/b1/history');
    expect(el().querySelector('.toggle')?.getAttribute('aria-expanded')).toBe('false');

    await toggle();
    http.expectOne('/api/boards/b1/history').flush([entry('1'), entry('2', 'member.removed')]);
    await fixture.whenStable();

    expect(el().querySelector('.toggle')?.getAttribute('aria-expanded')).toBe('true');
    expect([...el().querySelectorAll('.entries li span')].map((s) => s.textContent)).toEqual([
      'Ada gave Bob the role Viewer',
      'Ada removed Bob',
    ]);
  });

  it('asks for the history of a room by the room route, and only once', async () => {
    await create('room');
    await toggle();
    http.expectOne('/api/rooms/b1/history').flush([]);
    await fixture.whenStable();
    expect(el().textContent).toContain('Nothing was recorded yet.');

    await toggle(); // close
    await toggle(); // open again: no second request
  });

  it('says so when it cannot be loaded and tries again', async () => {
    await create();
    await toggle();
    http
      .expectOne('/api/boards/b1/history')
      .flush(null, { status: 500, statusText: 'Server Error' });
    await fixture.whenStable();
    expect(el().querySelector('[role="alert"]')?.textContent).toContain('could not be loaded');

    (el().querySelector('[role="alert"] button') as HTMLButtonElement).click();
    await fixture.whenStable();
    http.expectOne('/api/boards/b1/history').flush([entry('1')]);
    await fixture.whenStable();

    expect(el().querySelectorAll('.entries li').length).toBe(1);
  });
});
