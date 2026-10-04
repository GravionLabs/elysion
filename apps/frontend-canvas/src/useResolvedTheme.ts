import { useEffect, useState } from 'react';

export type CanvasTheme = 'light' | 'dark';

const DARK_QUERY = '(prefers-color-scheme: dark)';

export function parseTheme(value: string | null): CanvasTheme | undefined {
  return value === 'light' || value === 'dark' ? value : undefined;
}

function systemTheme(): CanvasTheme {
  return window.matchMedia?.(DARK_QUERY).matches ? 'dark' : 'light';
}

/** An explicit theme wins; otherwise the system preference, kept live. */
export function useResolvedTheme(theme: CanvasTheme | undefined): CanvasTheme {
  const [system, setSystem] = useState<CanvasTheme>(systemTheme);

  useEffect(() => {
    const query = window.matchMedia?.(DARK_QUERY);
    if (!query) return;
    const onChange = () => setSystem(query.matches ? 'dark' : 'light');
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);

  return theme ?? system;
}
