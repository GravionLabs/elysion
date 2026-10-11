import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RoomAccess } from './room-access';

const room = '0197a8d2-1c3e-7a10-8000-0000000000b1';

describe('RoomAccess', () => {
  let fixture: ComponentFixture<RoomAccess>;
  let http: HttpTestingController;
  const el = () => fixture.nativeElement as HTMLElement;
  const settle = async () => {
    await fixture.whenStable();
    fixture.detectChanges();
  };
  const open = async (answers: {
    role: 'Owner' | 'Editor' | 'Viewer';
    groups?: unknown[];
    members?: unknown[] | 'forbidden';
  }) => {
    fixture = TestBed.createComponent(RoomAccess);
    fixture.componentRef.setInput('roomId', room);
    await settle();
    await Promise.resolve();
    http
      .expectOne('/api/rooms')
      .flush([{ id: room, name: 'Sprint', createdAt: '2026-10-01T00:00:00Z', role: answers.role }]);
    http.expectOne(`/api/rooms/${room}/groups`).flush(answers.groups ?? []);
    const members = http.expectOne(`/api/rooms/${room}/members`);
    if (answers.members === 'forbidden') {
      members.flush(null, { status: 403, statusText: 'Forbidden' });
    } else {
      members.flush(answers.members ?? []);
    }
    await settle();
  };

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [RoomAccess],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    });
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify({ ignoreCancelled: true }));

  it('names the room, counts its people and lists its groups with their roles', async () => {
    await open({
      role: 'Owner',
      members: [{ userId: 'u1' }, { userId: 'u2' }],
      groups: [
        { groupId: 'g1', name: 'Design', role: 'Editor' },
        { groupId: 'g2', name: 'Sales', role: 'Viewer' },
      ],
    });

    const text = el().textContent!.replace(/\s+/g, ' ');
    expect(text).toContain('in the room “Sprint”');
    expect(text).toContain('2 people in the room');
    expect(text).toContain('Groups: Design (Editor), Sales (Viewer)');
  });

  it('links to the room for an owner of it, and has no controls', async () => {
    await open({ role: 'Owner' });

    expect(el().querySelector('a')?.getAttribute('href')).toBe(`/rooms/${room}`);
    expect(el().querySelector('select, input, form')).toBeNull();
  });

  it('has no link for somebody who cannot change the room, and no people count when the list is the owners’', async () => {
    await open({ role: 'Editor', members: 'forbidden' });

    expect(el().querySelector('a')).toBeNull();
    const text = el().textContent!;
    expect(text).toContain('only its owners can list them');
    expect(text).toContain('No groups');
  });

  it('says so when it cannot load, and tries again', async () => {
    fixture = TestBed.createComponent(RoomAccess);
    fixture.componentRef.setInput('roomId', room);
    await settle();
    await Promise.resolve();
    http.expectOne('/api/rooms').flush(null, { status: 500, statusText: 'Server Error' });
    await settle();
    expect(el().querySelector('[role="alert"]')?.textContent).toContain('could not be loaded');
    (el().querySelector('.link') as HTMLButtonElement).click();
    await settle();
    http.match(() => true).forEach((r) => !r.cancelled && r.flush([]));
  });
});
