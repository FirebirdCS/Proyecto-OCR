import { env } from '../config/env.js';

/**
 * Sales are bucketed by calendar day in one fixed time zone. Without it, a
 * receipt scanned at 11pm would land on tomorrow for a server running in UTC.
 */
export const STATS_TIME_ZONE =
  env.STATS_TIME_ZONE ?? Intl.DateTimeFormat().resolvedOptions().timeZone;

const dayFormat = new Intl.DateTimeFormat('en-CA', {
  timeZone: STATS_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** `YYYY-MM-DD` for the given instant, in the stats time zone. */
export function dayKey(date: Date): string {
  return dayFormat.format(date);
}

// From here on the arithmetic is on calendar dates, not instants, so daylight
// saving can never turn "one day back" into 23 or 25 hours.

function toUtc(key: string): Date {
  const [year, month, day] = key.split('-').map(Number);
  return new Date(Date.UTC(year!, month! - 1, day ?? 1));
}

const fromUtc = (date: Date) => date.toISOString().slice(0, 10);

export function addDays(key: string, days: number): string {
  const date = toUtc(key);
  date.setUTCDate(date.getUTCDate() + days);
  return fromUtc(date);
}

/** The Monday that opens the week containing `key`. */
export function weekStart(key: string): string {
  const offset = (toUtc(key).getUTCDay() + 6) % 7;
  return addDays(key, -offset);
}

/** `YYYY-MM` of a day key. */
export const monthOf = (key: string) => key.slice(0, 7);

export function addMonths(month: string, months: number): string {
  const date = toUtc(month);
  date.setUTCMonth(date.getUTCMonth() + months);
  return fromUtc(date).slice(0, 7);
}
