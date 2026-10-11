import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { firstValueFrom } from 'rxjs';
import { UsersApi } from './users-api';

describe('UsersApi', () => {
  it('searches the people with the text as the query, encoded', async () => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    const http = TestBed.inject(HttpTestingController);
    const found = [{ id: 'u1', displayName: 'Ada', email: null }];

    const result = firstValueFrom(TestBed.inject(UsersApi).search('ada & co'));

    const request = http.expectOne((r) => r.url === '/api/users');
    expect(request.request.method).toBe('GET');
    expect(request.request.params.get('query')).toBe('ada & co');
    request.flush(found);
    expect(await result).toEqual(found);
    http.verify();
  });
});
