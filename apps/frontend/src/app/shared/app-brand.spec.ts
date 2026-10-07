import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { AppBrand } from './app-brand';

describe('AppBrand', () => {
  let fixture: ComponentFixture<AppBrand>;
  const el = () => fixture.nativeElement as HTMLElement;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AppBrand],
      providers: [provideRouter([])],
    }).compileComponents();
    fixture = TestBed.createComponent(AppBrand);
    await fixture.whenStable();
  });

  it('shows the mark as a hidden SVG and no letter', () => {
    const mark = el().querySelector('svg.brand-mark');

    expect(mark).not.toBeNull();
    expect(mark?.getAttribute('aria-hidden')).toBe('true');
    expect(el().querySelector('.brand-mark')?.textContent?.trim()).toBe('');
  });

  it('keeps the name, the link to the board list and its label', () => {
    const link = el().querySelector('a.brand') as HTMLAnchorElement;

    expect(link.getAttribute('href')).toBe('/');
    expect(link.getAttribute('aria-label')).toBe('Elysion: all boards');
    expect(el().querySelector('.app-title')?.textContent).toBe('Elysion');
  });

  it('has none of the old gradient square styles', () => {
    expect(el().querySelector('span.brand-mark')).toBeNull();
  });
});
