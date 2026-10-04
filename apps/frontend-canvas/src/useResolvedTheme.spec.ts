import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseTheme, useResolvedTheme } from './useResolvedTheme';

function mockSystemTheme(dark: boolean) {
  let listener: (() => void) | undefined;
  const query = {
    matches: dark,
    addEventListener: (_: string, l: () => void) => (listener = l),
    removeEventListener: vi.fn(),
  };
  vi.stubGlobal('matchMedia', () => query);
  return {
    flip() {
      query.matches = !query.matches;
      listener?.();
    },
  };
}

describe('parseTheme', () => {
  it('accepts only light and dark', () => {
    expect(parseTheme('dark')).toBe('dark');
    expect(parseTheme('light')).toBe('light');
    expect(parseTheme('sepia')).toBeUndefined();
    expect(parseTheme(null)).toBeUndefined();
  });
});

describe('useResolvedTheme', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('prefers an explicit theme over the system preference', () => {
    mockSystemTheme(true);
    const { result } = renderHook(() => useResolvedTheme('light'));
    expect(result.current).toBe('light');
  });

  it('follows the system preference live while no theme is set', () => {
    const system = mockSystemTheme(false);
    const { result } = renderHook(() => useResolvedTheme(undefined));
    expect(result.current).toBe('light');

    act(() => system.flip());
    expect(result.current).toBe('dark');
  });
});
