/** A graduate record is "stale" when nothing has been reported for more than this many days. */
export const STALE_AFTER_DAYS = 90;

const DAY_MS = 86_400_000;

export function daysBetween(from: Date, to: Date): number {
  return Math.floor((to.getTime() - from.getTime()) / DAY_MS);
}

export function isStale(lastUpdate: Date | null | undefined, now: Date, thresholdDays = STALE_AFTER_DAYS): boolean {
  if (!lastUpdate) return true;
  return daysBetween(lastUpdate, now) > thresholdDays;
}

export function addDays(d: Date, days: number): Date {
  return new Date(d.getTime() + days * DAY_MS);
}

/** Adds calendar months in UTC, clamping to the last day of the target month (Jan 31 + 1m = Feb 28/29). */
export function addMonthsUtc(d: Date, months: number): Date {
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth() + months;
  const target = new Date(Date.UTC(y, m, 1, d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds()));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d.getUTCDate(), lastDay));
  return target;
}
