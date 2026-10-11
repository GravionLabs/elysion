import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import type {
  AdminGroup,
  AdminUser,
  GraphStatus,
  GroupMember,
  Page,
  PendingMember,
} from './admin-api';
import { AdminGroups } from './admin-groups';

const group = (n: number, source: AdminGroup['source'] = 'Local'): AdminGroup => ({
  id: `g${n}`,
  name: `Group ${n}`,
  source,
  externalId: source === 'Local' ? null : `ext-${n}`,
  memberCount: n,
  roomCount: 2,
});

const page = <T>(items: T[], total = items.length, number = 1): Page<T> => ({
  items,
  total,
  page: number,
  pageSize: 25,
});

const member = (n: number): GroupMember => ({
  id: `u${n}`,
  displayName: `Person ${n}`,
  email: `p${n}@x.io`,
});

describe('AdminGroups', () => {
  let fixture: ComponentFixture<AdminGroups>;
  let http: HttpTestingController;
  const el = () => fixture.nativeElement as HTMLElement;
  const rows = () => [...el().querySelectorAll('tbody tr')];
  const settle = () => fixture.whenStable();
  const click = async (element: Element | null) => {
    (element as HTMLElement).click();
    await settle();
  };
  const buttonIn = (root: Element, label: RegExp) =>
    [...root.querySelectorAll('button')].find((b) =>
      label.test((b.getAttribute('aria-label') ?? b.textContent ?? '').trim()),
    ) ?? null;
  const type = async (selector: string, value: string, root: Element = el()) => {
    const input = root.querySelector(selector) as HTMLInputElement;
    input.value = value;
    input.dispatchEvent(new Event('input'));
    await settle();
  };
  const submit = async (form: Element | null) => {
    form!.dispatchEvent(new Event('submit'));
    await settle();
  };
  const listRequest = (query = '', pageNumber = 1) =>
    http.expectOne(
      (r) =>
        r.url === '/api/admin/groups' &&
        r.params.get('page') === String(pageNumber) &&
        r.params.get('query') === (query || null),
    );

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AdminGroups],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(AdminGroups);
    await settle();
  });

  afterEach(() => http.verify());

  const GRAPH_OFF: GraphStatus = {
    enabled: false,
    intervalMinutes: 60,
    lastSyncAt: null,
    pendingMembers: 0,
  };

  /** Answers the three calls of opening the page: the groups, the Graph status and the sign-in settings. */
  const open = async (
    groups: AdminGroup[],
    settings: object = {},
    graph: GraphStatus | null = GRAPH_OFF,
  ) => {
    listRequest().flush(page(groups));
    const status = http.expectOne('/api/admin/graph');
    if (graph) {
      status.flush(graph);
    } else {
      status.flush(null, { status: 500, statusText: 'Server Error' });
    }
    http.expectOne('/auth-config.json').flush(settings);
    await settle();
  };

  it('lists the groups with their source, external id and counts', async () => {
    await open([group(1), group(2, 'IdentityProvider')], { idpHint: 'microsoft' });

    expect(rows().length).toBe(2);
    const cells = (row: Element) =>
      [...row.querySelectorAll('th, td')].map((c) => c.textContent?.trim());
    expect(cells(rows()[0]).slice(0, 5)).toEqual(['Group 1', 'Local', '', '1', '2']);
    expect(cells(rows()[1]).slice(0, 5)).toEqual(['Group 2', 'microsoft', 'ext-2', '2', '2']);
    expect([...el().querySelectorAll('thead th')].length).toBe(6);
  });

  it('calls a linked group by a general word when no provider is named', async () => {
    await open([group(1, 'IdentityProvider')]);

    expect(rows()[0].querySelectorAll('td')[0].textContent).toContain('Identity provider');
  });

  it('searches and pages', async () => {
    await open([group(1)]);
    await type('input[type="search"]', 'des');
    await submit(el().querySelector('form[role="search"]'));
    listRequest('des').flush(page([group(1)], 60));
    await settle();

    await click([...el().querySelectorAll('.pager button')][1]);
    listRequest('des', 2).flush(page([group(26)], 60, 2));
    await settle();

    expect(el().querySelector('.pager-text')?.textContent).toContain('Page 2 of 3');
  });

  it('says it when the list cannot be loaded', async () => {
    listRequest().flush(null, { status: 500, statusText: 'Server Error' });
    http.expectOne('/api/admin/graph').flush(GRAPH_OFF);
    http.expectOne('/auth-config.json').flush({});
    await settle();

    expect(el().querySelector('[role="alert"]')?.textContent).toContain('could not be loaded');
  });

  describe('a new group', () => {
    it('is made local with the name, then the list is loaded again', async () => {
      await open([]);
      await click(buttonIn(el(), /^New group$/));
      await type('input[name="newName"]', ' Design ');
      await submit(el().querySelector('form.new-group'));

      const request = http.expectOne('/api/admin/groups');
      expect(request.request.method).toBe('POST');
      expect(request.request.body).toEqual({ name: 'Design' });
      request.flush(group(1));
      await settle();
      listRequest().flush(page([group(1)]));
      await settle();

      expect(el().querySelector('form.new-group')).toBeNull();
      expect(rows().length).toBe(1);
    });

    it('asks for a name before it calls the API', async () => {
      await open([]);
      await click(buttonIn(el(), /^New group$/));
      await submit(el().querySelector('form.new-group'));

      expect(el().querySelector('[role="alert"]')?.textContent).toContain('needs a name');
    });

    it("shows the API's refusal next to the form", async () => {
      await open([]);
      await click(buttonIn(el(), /^New group$/));
      await type('input[name="newName"]', 'Design');
      await submit(el().querySelector('form.new-group'));
      http
        .expectOne('/api/admin/groups')
        .flush(
          { detail: 'A group with this name exists.' },
          { status: 409, statusText: 'Conflict' },
        );
      await settle();

      expect(el().querySelector('[role="alert"]')?.textContent).toContain(
        'A group with this name exists.',
      );
      expect(el().querySelector('form.new-group')).toBeTruthy();
    });
  });

  describe('renaming', () => {
    it('renames in the row and shows the new name', async () => {
      await open([group(1)]);
      await click(buttonIn(rows()[0], /^Rename the group Group 1$/));
      await type('input[name="rename"]', ' Designers ', rows()[0]);
      await submit(rows()[0].querySelector('form'));

      const request = http.expectOne('/api/admin/groups/g1');
      expect(request.request.method).toBe('PATCH');
      expect(request.request.body).toEqual({ name: 'Designers' });
      request.flush({ ...group(1), name: 'Designers' });
      await settle();

      expect(rows()[0].querySelector('th')?.textContent).toContain('Designers');
      expect(rows()[0].querySelector('form')).toBeNull();
    });

    it('does not call the API for an unchanged name, and Escape cancels', async () => {
      await open([group(1)]);
      await click(buttonIn(rows()[0], /^Rename the group/));
      await submit(rows()[0].querySelector('form'));
      expect(rows()[0].querySelector('form')).toBeNull();

      await click(buttonIn(rows()[0], /^Rename the group/));
      rows()[0]
        .querySelector('input[name="rename"]')!
        .dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await settle();
      expect(rows()[0].querySelector('form')).toBeNull();
    });

    it('says why it failed and stays open', async () => {
      await open([group(1)]);
      await click(buttonIn(rows()[0], /^Rename the group/));
      await type('input[name="rename"]', 'Other', rows()[0]);
      await submit(rows()[0].querySelector('form'));
      http
        .expectOne('/api/admin/groups/g1')
        .flush(null, { status: 500, statusText: 'Server Error' });
      await settle();

      expect(el().querySelector('[role="alert"]')?.textContent).toContain('could not be renamed');
      expect(rows()[0].querySelector('form')).toBeTruthy();
    });
  });

  describe('linking and unlinking', () => {
    it('links a local group to the id of a provider group, after the warning', async () => {
      await open([group(1)]);
      await click(buttonIn(rows()[0], /^Link the group Group 1/));

      const dialog = el().querySelector('[role="dialog"]')!;
      expect(dialog.textContent).toContain('the provider owns the members');
      await type('input[name="externalId"]', ' 11111111-aaaa ', dialog);
      await submit(dialog.querySelector('form'));

      const request = http.expectOne('/api/admin/groups/g1');
      expect(request.request.body).toEqual({ externalId: '11111111-aaaa' });
      request.flush({ ...group(1, 'IdentityProvider'), externalId: '11111111-aaaa' });
      await settle();

      expect(el().querySelector('[role="dialog"]')).toBeNull();
      expect(rows()[0].querySelector('.external-id')?.textContent).toBe('11111111-aaaa');
      expect(buttonIn(rows()[0], /^Unlink the group/)).toBeTruthy();
    });

    it('asks for an id, and shows a clash with another group', async () => {
      await open([group(1)]);
      await click(buttonIn(rows()[0], /^Link the group/));
      const dialog = el().querySelector('[role="dialog"]')!;
      await submit(dialog.querySelector('form'));
      expect(dialog.querySelector('[role="alert"]')?.textContent).toContain('Enter the id');

      await type('input[name="externalId"]', 'taken', dialog);
      await submit(dialog.querySelector('form'));
      http
        .expectOne('/api/admin/groups/g1')
        .flush({ detail: 'Another group has this id.' }, { status: 409, statusText: 'Conflict' });
      await settle();

      expect(dialog.querySelector('[role="alert"]')?.textContent).toContain(
        'Another group has this id.',
      );
    });

    it('unlinks a linked group after the explanation: it keeps its members', async () => {
      await open([group(2, 'IdentityProvider')]);
      await click(buttonIn(rows()[0], /^Unlink the group/));

      const dialog = el().querySelector('[role="dialog"]')!;
      expect(dialog.textContent).toContain('keeps its members');
      await click(buttonIn(dialog, /^Unlink$/));

      const request = http.expectOne('/api/admin/groups/g2');
      expect(request.request.body).toEqual({ externalId: null });
      request.flush({ ...group(2), externalId: null });
      await settle();

      expect(rows()[0].querySelectorAll('td')[0].textContent).toContain('Local');
      expect(buttonIn(rows()[0], /^Link the group/)).toBeTruthy();
    });
  });

  describe('deleting', () => {
    it('says how many members and rooms are affected, then deletes and loads again', async () => {
      await open([group(3)]);
      await click(buttonIn(rows()[0], /^Delete the group Group 3/));

      const dialog = el().querySelector('[role="dialog"]')!;
      expect(dialog.textContent).toContain('(3)');
      expect(dialog.textContent).toContain('(2)');
      await click(buttonIn(dialog, /^Delete$/));

      const request = http.expectOne('/api/admin/groups/g3');
      expect(request.request.method).toBe('DELETE');
      request.flush(null, { status: 204, statusText: 'No Content' });
      await settle();
      listRequest().flush(page([]));
      await settle();

      expect(el().querySelector('[role="dialog"]')).toBeNull();
      expect(el().textContent).toContain('No group matches');
    });

    it('keeps the dialog and says why when it fails; Cancel changes nothing', async () => {
      await open([group(3)]);
      await click(buttonIn(rows()[0], /^Delete the group/));
      const dialog = el().querySelector('[role="dialog"]')!;
      await click(buttonIn(dialog, /^Delete$/));
      http
        .expectOne('/api/admin/groups/g3')
        .flush(null, { status: 500, statusText: 'Server Error' });
      await settle();
      expect(dialog.querySelector('[role="alert"]')?.textContent).toContain('could not be deleted');

      await click(buttonIn(dialog, /^Cancel$/));
      expect(el().querySelector('[role="dialog"]')).toBeNull();
      expect(rows().length).toBe(1);
    });
  });

  describe('the members', () => {
    const user = (n: number): AdminUser => ({
      id: `u${n}`,
      displayName: `Person ${n}`,
      email: `p${n}@x.io`,
      createdAt: '',
      lastSeenAt: null,
      groups: [],
    });
    const membersRequest = (id: string, pageNumber = 1) =>
      http.expectOne(
        (r) =>
          r.url === `/api/admin/groups/${id}/members` &&
          r.params.get('page') === String(pageNumber),
      );

    it('lists the members of a local group and removes one', async () => {
      await open([group(1)]);
      await click(rows()[0].querySelector('button.link'));
      membersRequest('g1').flush(page([member(1), member(2)]));
      await settle();

      const dialog = el().querySelector('[role="dialog"]')!;
      expect(dialog.querySelectorAll('.stack .line').length).toBe(2);
      await click(buttonIn(dialog, /^Remove Person 1 from the group$/));
      const request = http.expectOne('/api/admin/groups/g1/members/u1');
      expect(request.request.method).toBe('DELETE');
      request.flush(null, { status: 204, statusText: 'No Content' });
      await settle();
      membersRequest('g1').flush(page([member(2)]));
      listRequest().flush(page([{ ...group(1), memberCount: 1 }]));
      await settle();

      expect(dialog.querySelectorAll('.stack .line').length).toBe(1);
      expect(rows()[0].querySelectorAll('td')[2].textContent?.trim()).toBe('1');
    });

    it('finds a person by name or email in the user list and adds them', async () => {
      await open([group(1)]);
      await click(rows()[0].querySelector('button.link'));
      membersRequest('g1').flush(page([]));
      await settle();

      const dialog = el().querySelector('[role="dialog"]')!;
      await type('input[name="candidate"]', 'zoe', dialog);
      await submit(dialog.querySelector('form'));
      const search = http.expectOne(
        (r) => r.url === '/api/admin/users' && r.params.get('query') === 'zoe',
      );
      expect(search.request.params.get('pageSize')).toBe('8');
      search.flush(page([user(7)]));
      await settle();

      await click(buttonIn(dialog, /^Add Person 7 to the group$/));
      const request = http.expectOne('/api/admin/groups/g1/members/u7');
      expect(request.request.method).toBe('PUT');
      request.flush(null, { status: 204, statusText: 'No Content' });
      await settle();
      membersRequest('g1').flush(page([member(7)]));
      listRequest().flush(page([{ ...group(1), memberCount: 1 }]));
      await settle();

      expect(dialog.textContent).toContain('Person 7');
    });

    it('does not offer a deactivated person to add, and marks one that is a member (#668)', async () => {
      await open([group(1)]);
      await click(rows()[0].querySelector('button.link'));
      membersRequest('g1').flush(
        page([{ ...member(1), deactivatedAt: '2026-10-10T10:00:00Z' }, member(2)]),
      );
      await settle();
      const dialog = el().querySelector('[role="dialog"]')!;
      expect(dialog.querySelectorAll('.stack .line .chip').length).toBe(1);

      await type('input[name="candidate"]', 'per', dialog);
      await submit(dialog.querySelector('form'));
      http
        .expectOne((r) => r.url === '/api/admin/users' && r.params.get('query') === 'per')
        .flush(page([user(7), { ...user(8), deactivatedAt: '2026-10-10T10:00:00Z' }]));
      await settle();

      expect(buttonIn(dialog, /^Add Person 7 to the group$/)).toBeTruthy();
      expect(buttonIn(dialog, /^Add Person 8 to the group$/)).toBeFalsy();
    });

    it('says when nobody matches the search and when the search fails', async () => {
      await open([group(1)]);
      await click(rows()[0].querySelector('button.link'));
      membersRequest('g1').flush(page([]));
      await settle();
      const dialog = el().querySelector('[role="dialog"]')!;

      await type('input[name="candidate"]', 'nobody', dialog);
      await submit(dialog.querySelector('form'));
      http.expectOne((r) => r.url === '/api/admin/users').flush(page([]));
      await settle();
      expect(dialog.textContent).toContain('Nobody matches');

      await submit(dialog.querySelector('form'));
      http
        .expectOne((r) => r.url === '/api/admin/users')
        .flush(null, { status: 500, statusText: 'Server Error' });
      await settle();
      expect(dialog.querySelector('[role="alert"]')?.textContent).toContain('The search failed');
    });

    it('shows the members of a linked group but offers no way to change them', async () => {
      await open([group(2, 'IdentityProvider')]);
      await click(rows()[0].querySelector('button.link'));
      membersRequest('g2').flush(page([member(1)]));
      await settle();

      const dialog = el().querySelector('[role="dialog"]')!;
      expect(dialog.textContent).toContain('owns the members');
      expect(dialog.textContent).toContain('Person 1');
      expect(dialog.querySelector('input[name="candidate"]')).toBeNull();
      expect(buttonIn(dialog, /^Remove/)).toBeNull();
    });

    it('says when the members cannot be loaded and when a change is refused', async () => {
      await open([group(1)]);
      await click(rows()[0].querySelector('button.link'));
      membersRequest('g1').flush(null, { status: 500, statusText: 'Server Error' });
      await settle();
      const dialog = el().querySelector('[role="dialog"]')!;
      expect(dialog.querySelector('[role="alert"]')?.textContent).toContain(
        'members could not be loaded',
      );

      await click(buttonIn(dialog, /^Try again$/));
      membersRequest('g1').flush(page([member(1)]));
      await settle();
      await click(buttonIn(dialog, /^Remove Person 1/));
      http
        .expectOne('/api/admin/groups/g1/members/u1')
        .flush(
          { detail: 'The provider owns its members.' },
          { status: 409, statusText: 'Conflict' },
        );
      await settle();
      expect(dialog.querySelector('[role="alert"]')?.textContent).toContain(
        'The provider owns its members.',
      );
    });
  });

  describe('Microsoft Graph (#667)', () => {
    const statusLine = () =>
      el().querySelector('.graph-status')?.textContent?.replace(/\s+/g, ' ').trim();

    it('says that the sync is off, and nothing else', async () => {
      await open([group(1)]);

      expect(statusLine()).toContain('Microsoft Graph is not switched on');
      expect(statusLine()).not.toContain('wait');
    });

    it('says how often it reads, when it last did and how many people wait', async () => {
      await open(
        [group(1, 'IdentityProvider')],
        {},
        {
          enabled: true,
          intervalMinutes: 30,
          lastSyncAt: '2026-10-11T08:00:00Z',
          pendingMembers: 3,
        },
      );

      expect(statusLine()).toContain('every 30 minutes');
      expect(statusLine()).toContain('Last read:');
      expect(statusLine()).toContain('Waiting for their first sign-in: 3');
    });

    it('says that nothing was read yet', async () => {
      await open(
        [group(1)],
        {},
        { enabled: true, intervalMinutes: 60, lastSyncAt: null, pendingMembers: 0 },
      );

      expect(statusLine()).toContain('Not read yet');
    });

    it('shows no status line when the status cannot be loaded', async () => {
      await open([group(1)], {}, null);

      expect(el().querySelector('.graph-status')).toBeNull();
      expect(rows().length).toBe(1);
    });

    it('shows the pending count next to the members and lists the waiting people in the detail', async () => {
      const linked = {
        ...group(2, 'IdentityProvider'),
        pendingCount: 2,
        lastSyncAt: '2026-10-11T08:00:00Z',
      };
      await open([linked]);
      expect(rows()[0].querySelectorAll('td')[2].textContent).toContain('+2 waiting');

      await click(buttonIn(rows()[0], /^Show the members of/));
      http.expectOne((r) => r.url === '/api/admin/groups/g2/members').flush(page<GroupMember>([]));
      const waiting: PendingMember[] = [
        { email: 'adam@example.com', displayName: null },
        { email: 'zoe@example.com', displayName: 'Zoe Z' },
      ];
      http.expectOne((r) => r.url === '/api/admin/groups/g2/pending').flush(page(waiting));
      await settle();

      const dialog = document.querySelector('[role="dialog"]')!;
      expect(dialog.textContent).toContain('Waiting for their first sign-in');
      expect(dialog.textContent).toContain('Last read from the directory');
      expect(dialog.textContent).toContain('Zoe Z');
      expect(dialog.textContent).toContain('adam@example.com');
    });

    it('does not ask for pending people of a group that has none', async () => {
      await open([group(2, 'IdentityProvider')]);

      await click(buttonIn(rows()[0], /^Show the members of/));
      http.expectOne((r) => r.url === '/api/admin/groups/g2/members').flush(page<GroupMember>([]));
      await settle();

      http.expectNone((r) => r.url.endsWith('/pending'));
      expect(document.querySelector('[role="dialog"]')?.textContent).not.toContain(
        'Waiting for their first',
      );
    });
  });
});
