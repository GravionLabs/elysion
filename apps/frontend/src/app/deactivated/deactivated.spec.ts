import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { SessionService } from '../auth/session.service';
import { FakeSession, provideFakeSession } from '../auth/testing';
import { Deactivated } from './deactivated';

describe('Deactivated', () => {
  let fixture: ComponentFixture<Deactivated>;
  let http: HttpTestingController;
  const el = () => fixture.nativeElement as HTMLElement;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Deactivated],
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        provideFakeSession(),
      ],
    }).compileComponents();
    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(Deactivated);
    await fixture.whenStable();
  });

  afterEach(() => http.verify());

  it('says nothing until it knows, then that the account is deactivated, with Log out', async () => {
    expect(el().textContent).toContain('Checking your account');
    expect(el().querySelector('h1')).toBeNull();

    http
      .expectOne('/api/rooms')
      .flush({ code: 'account-deactivated' }, { status: 403, statusText: 'Forbidden' });
    await fixture.whenStable();

    expect(el().querySelector('h1')?.textContent).toContain('deactivated');
    expect(el().querySelector('[role="alert"]')?.textContent).toContain('administrator');
    (el().querySelector('button') as HTMLButtonElement).click();
    expect((TestBed.inject(SessionService) as unknown as FakeSession).logoutCalls).toBe(1);
  });

  it('sends a person whose account works on to the board list', async () => {
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);

    http.expectOne('/api/rooms').flush([]);
    await fixture.whenStable();

    expect(navigate).toHaveBeenCalledWith('/', { replaceUrl: true });
    expect(el().querySelector('h1')).toBeNull();
  });
});
