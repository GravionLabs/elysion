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
  const items = () => [...el().querySelectorAll('[role="menuitem"]')] as HTMLButtonElement[];

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

  it('does not ask again once the catalog is loaded', async () => {
    await open();
    http.expectOne('/api/templates').flush(TEMPLATES);
    await fixture.whenStable();

    await open(); // close
    await open(); // open again

    http.expectNone('/api/templates');
    expect(items()).toHaveLength(2);
  });

  it('says so when the catalog cannot be loaded, and tries again on request', async () => {
    await open();
    http.expectOne('/api/templates').flush(null, { status: 502, statusText: 'Bad Gateway' });
    await fixture.whenStable();
    expect(el().querySelector('[role="alert"]')?.textContent).toContain('could not be loaded');

    items()[0].click(); // Try again
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
