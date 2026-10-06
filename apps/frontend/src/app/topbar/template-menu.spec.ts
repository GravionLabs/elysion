import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TemplateInfo } from '../board/template-api';
import { TemplateMenu } from './template-menu';

const TEMPLATES: TemplateInfo[] = [
  {
    id: 't1',
    name: 'Retrospective',
    description: 'Three columns.',
    isBuiltIn: true,
    createdAt: '',
  },
  { id: 't2', name: 'Kanban', description: 'To do, Doing, Done.', isBuiltIn: true, createdAt: '' },
];

describe('TemplateMenu', () => {
  let fixture: ComponentFixture<TemplateMenu>;
  let http: HttpTestingController;
  let chosen: TemplateInfo[];
  const el = () => fixture.nativeElement as HTMLElement;
  const trigger = () => el().querySelector('button') as HTMLButtonElement;
  const items = () => [...el().querySelectorAll('.menu-row .menu-item')] as HTMLButtonElement[];
  const button = (label: string) =>
    [...el().querySelectorAll('button')].find(
      (b) =>
        (b.textContent ?? '').includes(label) ||
        (b.getAttribute('aria-label') ?? '').includes(label),
    ) as HTMLButtonElement;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [TemplateMenu],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(TemplateMenu);
    chosen = [];
    fixture.componentInstance.templateChosen.subscribe((template) => chosen.push(template));
    await fixture.whenStable();
  });

  afterEach(() => http.verify());

  const open = async () => {
    trigger().click();
    await fixture.whenStable();
  };

  it('asks for the catalog only when it is opened, and lists the templates with their descriptions', async () => {
    http.expectNone('/api/templates');

    await open();
    expect(el().textContent).toContain('Loading templates');
    http.expectOne('/api/templates').flush(TEMPLATES);
    await fixture.whenStable();

    expect(items().map((item) => item.textContent)).toEqual([
      expect.stringContaining('Retrospective'),
      expect.stringContaining('Kanban'),
    ]);
    expect(el().textContent).toContain('Three columns.');
  });

  it('reports the chosen template and closes', async () => {
    await open();
    http.expectOne('/api/templates').flush(TEMPLATES);
    await fixture.whenStable();

    items()[1].click();
    await fixture.whenStable();

    expect(chosen).toEqual([TEMPLATES[1]]);
    expect(el().querySelector('[role="menu"]')).toBeNull();
  });

  it('asks again every time it is opened, showing the old list meanwhile', async () => {
    await open();
    http.expectOne('/api/templates').flush(TEMPLATES);
    await fixture.whenStable();

    await open(); // close
    await open(); // open again

    expect(items()).toHaveLength(2);
    http
      .expectOne('/api/templates')
      .flush([...TEMPLATES, { ...TEMPLATES[0], id: 't3', name: 'Mine', isBuiltIn: false }]);
    await fixture.whenStable();
    expect(items()).toHaveLength(3);
  });

  it('asks the page to save the board, or the selection when there is one', async () => {
    const saves: { selectionOnly: boolean }[] = [];
    fixture.componentInstance.saveRequested.subscribe((request) => saves.push(request));
    await open();
    http.expectOne('/api/templates').flush(TEMPLATES);
    await fixture.whenStable();
    expect(button('Save selection').disabled).toBe(true);

    button('Save board').click();
    await fixture.whenStable();
    expect(saves).toEqual([{ selectionOnly: false }]);
    expect(el().querySelector('[role="menu"]')).toBeNull();

    fixture.componentRef.setInput('hasSelection', true);
    await open();
    http.expectOne('/api/templates').flush(TEMPLATES);
    await fixture.whenStable();
    button('Save selection').click();
    expect(saves.at(-1)).toEqual({ selectionOnly: true });
  });

  describe('own templates', () => {
    const MINE: TemplateInfo = { ...TEMPLATES[0], id: 't3', name: 'Mine', isBuiltIn: false };

    beforeEach(async () => {
      await open();
      http.expectOne('/api/templates').flush([...TEMPLATES, MINE]);
      await fixture.whenStable();
    });

    it('offers Delete for own templates only', () => {
      const deletes = [...el().querySelectorAll('.menu-icon')];
      expect(deletes.map((d) => d.getAttribute('aria-label'))).toEqual([
        'Delete the template Mine',
      ]);
    });

    it('asks before deleting, then deletes and removes it from the list', async () => {
      button('Delete the template Mine').click();
      await fixture.whenStable();
      http.expectNone('/api/templates/t3');
      expect(el().textContent).toContain('Delete “Mine”?');

      button('Delete “Mine”?').click();
      await fixture.whenStable();
      const request = http.expectOne('/api/templates/t3');
      expect(request.request.method).toBe('DELETE');
      request.flush(null, { status: 204, statusText: 'No Content' });
      await fixture.whenStable();

      expect(items().map((i) => i.textContent)).not.toContain(expect.stringContaining('Mine'));
      expect(items()).toHaveLength(2);
    });

    it('keeps the template when the question is declined', async () => {
      button('Delete the template Mine').click();
      await fixture.whenStable();

      button('Keep the template').click();
      await fixture.whenStable();

      expect(items()).toHaveLength(3);
    });

    it('says so when the deletion fails and keeps the template', async () => {
      button('Delete the template Mine').click();
      await fixture.whenStable();
      button('Delete “Mine”?').click();
      await fixture.whenStable();
      http.expectOne('/api/templates/t3').flush(null, { status: 502, statusText: 'Bad Gateway' });
      await fixture.whenStable();

      expect(el().textContent).toContain('could not be deleted');
      expect(items()).toHaveLength(3);
    });
  });

  it('says so when the catalog cannot be loaded, and tries again on request', async () => {
    await open();
    http.expectOne('/api/templates').flush(null, { status: 502, statusText: 'Bad Gateway' });
    await fixture.whenStable();
    expect(el().querySelector('[role="alert"]')?.textContent).toContain('could not be loaded');

    button('Try again').click();
    await fixture.whenStable();
    http.expectOne('/api/templates').flush(TEMPLATES);
    await fixture.whenStable();

    expect(items()).toHaveLength(2);
  });

  it('closes on Escape', async () => {
    await open();
    http.expectOne('/api/templates').flush(TEMPLATES);

    el().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await fixture.whenStable();

    expect(el().querySelector('[role="menu"]')).toBeNull();
  });
});
