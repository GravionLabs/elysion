import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../i18n';
import { NOT_FOLLOWING, type FollowState } from './follow';
import { FollowOverlay } from './FollowOverlay';

const ada = { id: 'ada', name: 'Ada', color: '#14b8a6' };

function show(state: FollowState, locale: 'en' | 'de' = 'en', onFollowPresenter = vi.fn()) {
  render(
    <I18nProvider locale={locale}>
      <FollowOverlay state={state} onFollowPresenter={onFollowPresenter} />
    </I18nProvider>,
  );
  return onFollowPresenter;
}

describe('FollowOverlay', () => {
  it('has an empty status region, always in the page, while nobody is followed', () => {
    show(NOT_FOLLOWING);

    expect(screen.getByRole('status').textContent).toBe('');
    expect(screen.queryByTestId('follow-frame')).toBeNull();
  });

  it('announces whom the person follows and frames the canvas in their color', () => {
    show({
      following: { ...ada, reason: 'person' },
      presenter: null,
      steppedOut: false,
    });

    expect(screen.getByRole('status').textContent).toBe('Following Ada — Esc to stop');
    const frame = screen.getByTestId('follow-frame');
    expect((frame.parentElement as HTMLElement).style.getPropertyValue('--follow-color')).toBe(
      '#14b8a6',
    );
  });

  it('says it in German too', () => {
    show({ following: { ...ada, reason: 'person' }, presenter: null, steppedOut: false }, 'de');

    expect(screen.getByRole('status').textContent).toBe('Du folgst Ada — Esc zum Beenden');
  });

  it('offers a way back into a presentation that was left', () => {
    const onFollowPresenter = show({
      following: null,
      presenter: { ...ada, me: false },
      steppedOut: true,
    });

    expect(screen.getByRole('status').textContent).toContain('Ada is presenting');
    fireEvent.click(screen.getByRole('button', { name: 'Follow presenter' }));
    expect(onFollowPresenter).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('follow-frame')).toBeNull();
  });

  it('tells the presenter that everybody follows them, without a frame or button', () => {
    show({ following: null, presenter: { ...ada, me: true }, steppedOut: false });

    expect(screen.getByRole('status').textContent).toBe(
      'You are presenting — everybody follows you',
    );
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.queryByTestId('follow-frame')).toBeNull();
  });

  it('shows nothing about a presentation somebody follows already beyond the following pill', () => {
    show({
      following: { ...ada, reason: 'presenter' },
      presenter: { ...ada, me: false },
      steppedOut: false,
    });

    expect(screen.getByRole('status').textContent).toBe('Following Ada — Esc to stop');
    expect(screen.queryByRole('button')).toBeNull();
  });
});
