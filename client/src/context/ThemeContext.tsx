import { createContext, useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';

export type ThemePreference = 'light' | 'dark';

export interface ThemeContextValue {
  /** The explicit choice, or null when following the OS preference. */
  preference: ThemePreference | null;
  /** The theme actually in effect right now. */
  resolved: ThemePreference;
  toggle: () => void;
}

export const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

const STORAGE_KEY = 'ocr-theme';

function readStoredPreference(): ThemePreference | null {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    return value === 'light' || value === 'dark' ? value : null;
  } catch {
    return null;
  }
}

function systemPreference(): ThemePreference {
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [preference, setPreference] = useState<ThemePreference | null>(readStoredPreference);

  useEffect(() => {
    if (preference) {
      document.documentElement.dataset.theme = preference;
    } else {
      delete document.documentElement.dataset.theme;
    }
  }, [preference]);

  const toggle = useCallback(() => {
    setPreference((current) => {
      const next: ThemePreference = (current ?? systemPreference()) === 'dark' ? 'light' : 'dark';
      try {
        localStorage.setItem(STORAGE_KEY, next);
      } catch {
        // Private browsing or storage disabled — the choice just won't persist.
      }
      return next;
    });
  }, []);

  const value = useMemo<ThemeContextValue>(
    () => ({ preference, resolved: preference ?? systemPreference(), toggle }),
    [preference, toggle],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}
