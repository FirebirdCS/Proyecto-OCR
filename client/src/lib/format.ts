import type { SalesGranularity } from '../types/scoring';

const numberFormat = new Intl.NumberFormat('es');

export function formatNumber(value: number): string {
  return numberFormat.format(value);
}

// Bucket keys are calendar dates already resolved in the server's stats time
// zone, so they are read as UTC to keep the browser's zone from shifting them.
const bucketFormats: Record<SalesGranularity, Record<'short' | 'long', Intl.DateTimeFormat>> = {
  daily: {
    short: new Intl.DateTimeFormat('es', { day: 'numeric', month: 'short', timeZone: 'UTC' }),
    long: new Intl.DateTimeFormat('es', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' }),
  },
  weekly: {
    short: new Intl.DateTimeFormat('es', { day: 'numeric', month: 'short', timeZone: 'UTC' }),
    long: new Intl.DateTimeFormat('es', { day: 'numeric', month: 'long', timeZone: 'UTC' }),
  },
  monthly: {
    short: new Intl.DateTimeFormat('es', { month: 'short', timeZone: 'UTC' }),
    long: new Intl.DateTimeFormat('es', { month: 'long', year: 'numeric', timeZone: 'UTC' }),
  },
};

/** "15 sep" / "lunes, 15 de septiembre", "Semana del 8 de septiembre", "sept" / "septiembre de 2026". */
export function formatBucket(key: string, granularity: SalesGranularity, style: 'short' | 'long'): string {
  const [year, month, day] = key.split('-').map(Number);
  const text = bucketFormats[granularity][style].format(new Date(Date.UTC(year!, month! - 1, day ?? 1)));
  const label = granularity === 'weekly' && style === 'long' ? `Semana del ${text}` : text;
  return label.charAt(0).toUpperCase() + label.slice(1);
}

/** Initials for an avatar — from a display name, falling back to the email's local part. */
export function getInitials(name: string | null | undefined, email: string | null | undefined): string {
  const source = name?.trim() || email?.split('@')[0] || '';
  if (!source) return '?';

  const parts = source.split(/[\s._-]+/).filter(Boolean);
  const letters = parts.slice(0, 2).map((part) => part[0]!.toUpperCase());
  return letters.join('') || '?';
}
