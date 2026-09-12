import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactElement, ReactNode } from 'react';

export type ThemeMode = 'light' | 'dark';

type ThemeContextValue = {
  mode: ThemeMode;
  toggle: () => void;
};

const themeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider(props: { children: ReactNode }): ReactElement {
  const [mode, setMode] = useState<ThemeMode>(() => {
    const saved = window.localStorage.getItem('reviewflow-theme');
    return saved === 'dark' ? 'dark' : 'light';
  });

  useEffect(() => {
    document.documentElement.dataset.theme = mode;
    window.localStorage.setItem('reviewflow-theme', mode);
  }, [mode]);

  const value = useMemo(
    () => ({ mode, toggle: () => setMode((current) => (current === 'light' ? 'dark' : 'light')) }),
    [mode],
  );

  return <themeContext.Provider value={value}>{props.children}</themeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const value = useContext(themeContext);
  if (value === null) throw new Error('useTheme must be used inside ThemeProvider');
  return value;
}
