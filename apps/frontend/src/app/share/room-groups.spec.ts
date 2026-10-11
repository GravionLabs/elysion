import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { RoomGroups } from './room-groups';

const room = '0197a8d2-1c3e-7a10-8000-0000000000b1';
const url = `/api/rooms/${room}/groups`;
const design = { groupId: 'g1', name: 'Design', role: 'Editor' };
const sales = { groupId: 'g2', name: 'Sales', role: 'Viewer' };

describe('RoomGroups', () => {
  let fixture: ComponentFixture<RoomGroups>;
  let http: HttpTestingController;
  const el = () => fixture.nativeElement as HTMLElement;
  const rows = () => [...el().querySelectorAll('.group')] as HTMLElement[];
  const select = (label: string) =>
    el().querySelector(`select[aria-label="${label}"]`) as HTMLSelectElement;
  const settle = async () => {
    await fixture.whenStable();
    fixture.detectChanges();
  };
  const later = (ms = 300) => new Promise((resolve) => setTimeout(resolve, ms));
  const create = async (readOnly = false) => {
    fixture = TestBed.createComponent(RoomGroups);
    fixture.componentRef.setInput('roomId', room);
    fixture.componentRef.setInput('readOnly', readOnly);
    await settle();
    await later(0);
  };
  const open = async (groups = [design, sales], readOnly = false) => {
    await create(readOnly);
    http.expectOne(url).flush(groups);
    await settle();
  };
  const type = async (text: string) => {
    const input = el().querySelector('app-typeahead input') as HTMLInputElement;
    input.value = text;
    input.dispatchEvent(new Event('input'));
    await later();
    await settle();
  };
  const submit = async () => {
    (el().querySelector('form') as HTMLFormElement).dispatchEvent(
      new Event('submit', { cancelable: true }),
    );
    await settle();
  };

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [RoomGroups],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('lists the groups with their roles', async () => {
    await open();

    expect(rows().map((r) => r.querySelector('.group-name')?.textContent)).toEqual([
      'Design',
      'Sales',
    ]);
    expect(select('Role of the group Design').value).toBe('Editor');
    expect(select('Role of the group Sales').value).toBe('Viewer');
  });

  it('says so when no group has a role yet', async () => {
    await open([]);

    expect(el().textContent).toContain('No group has a role in this room yet.');
  });

  it('is a list only when read only: no form, no select, no Remove', async () => {
    await open([design], true);

    expect(el().querySelector('form')).toBeNull();
    expect(el().querySelector('select')).toBeNull();
    expect(el().querySelector('.remove')).toBeNull();
    expect(el().querySelector('.group-role')?.textContent).toBe('Editor');
  });

  it('searches by name, labels where a group comes from, and adds the one chosen with the role', async () => {
    await open([design]);

    await type('sa');
    const search = http.expectOne((r) => r.url === '/api/groups');
    expect(search.request.params.get('query')).toBe('sa');
    search.flush([
      { id: 'g2', name: 'Sales', source: 'IdentityProvider' },
      { id: 'g3', name: 'Safety', source: 'Local' },
      { id: 'g4', name: 'Sandbox Design', source: 'Local' },
    ]);
    await settle();
    const options = [...el().querySelectorAll('[role="option"]')] as HTMLElement[];
    expect(
      options.map((o) => [...o.querySelectorAll('span')].map((x) => x.textContent).join(' ')),
    ).toEqual(['Sales from Microsoft Entra ID', 'Safety local', 'Sandbox Design local']);

    options[0].dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    await settle();
    const role = select('Role of the new group');
    role.value = 'Viewer';
    role.dispatchEvent(new Event('change'));
    await submit();

    const put = http.expectOne(`${url}/g2`);
    expect(put.request.method).toBe('PUT');
    expect(put.request.body).toEqual({ role: 'Viewer' });
    put.flush(sales);
    await settle();
    expect(rows().map((r) => r.querySelector('.group-name')?.textContent)).toEqual([
      'Design',
      'Sales',
    ]);
    expect((el().querySelector('app-typeahead input') as HTMLInputElement).value).toBe('');
  });

  it('does not offer a group that has a role already', async () => {
    await open([design]);

    await type('de');
    http
      .expectOne((r) => r.url === '/api/groups')
      .flush([{ id: 'g1', name: 'Design', source: 'Local' }]);
    await settle();

    expect(el().querySelectorAll('[role="option"]')).toHaveLength(0);
    expect(el().querySelector('app-typeahead [role="status"]')?.textContent).toBe(
      'No group found.',
    );
  });

  it('wants a group chosen from the list, not just a name typed', async () => {
    await open([]);
    await type('Sales');
    http.expectOne((r) => r.url === '/api/groups').flush([]);
    await settle();

    await submit();

    expect(el().querySelector('.error')?.textContent).toContain('choose one from the list');
  });

  it('changes a role and puts the old one back with the message when the API refuses', async () => {
    await open();

    const editor = select('Role of the group Design');
    editor.value = 'Viewer';
    editor.dispatchEvent(new Event('change'));
    http.expectOne(`${url}/g1`).flush({ ...design, role: 'Viewer' });
    await settle();
    expect(select('Role of the group Design').value).toBe('Viewer');

    const again = select('Role of the group Sales');
    again.value = 'Owner';
    again.dispatchEvent(new Event('change'));
    http
      .expectOne(`${url}/g2`)
      .flush({ message: 'Not allowed.' }, { status: 403, statusText: 'Forbidden' });
    await settle();
    expect(el().querySelector('.error')?.textContent).toContain('Not allowed.');
    expect(select('Role of the group Sales').value).toBe('Viewer');
  });

  it('removes a group, and shows a refusal with the group still there', async () => {
    await open();

    (
      el().querySelector('button[aria-label="Remove the group Design"]') as HTMLButtonElement
    ).click();
    const refused = http.expectOne(`${url}/g1`);
    expect(refused.request.method).toBe('DELETE');
    refused.flush(null, { status: 403, statusText: 'Forbidden' });
    await settle();
    expect(el().querySelector('.error')?.textContent).toContain('Only an owner of the room');
    expect(rows()).toHaveLength(2);

    (
      el().querySelector('button[aria-label="Remove the group Design"]') as HTMLButtonElement
    ).click();
    http.expectOne(`${url}/g1`).flush(null, { status: 204, statusText: 'No Content' });
    await settle();
    expect(rows().map((r) => r.querySelector('.group-name')?.textContent)).toEqual(['Sales']);
  });

  it('shows why the groups could not be loaded, and tries again', async () => {
    await create();
    http.expectOne(url).flush({ message: 'Nope' }, { status: 500, statusText: 'Server Error' });
    await settle();
    expect(el().querySelector('.error')?.textContent).toContain('Nope');

    (el().querySelector('.link') as HTMLButtonElement).click();
    await settle();
    http.expectOne(url).flush([design]);
    await settle();
    expect(rows()).toHaveLength(1);
  });

  it('shows the message of a failed search', async () => {
    await open([]);

    await type('sa');
    http
      .expectOne((r) => r.url === '/api/groups')
      .flush({ message: 'Too short.' }, { status: 400, statusText: 'Bad Request' });
    await settle();

    expect(el().querySelector('.error')?.textContent).toContain('Too short.');
  });
});
