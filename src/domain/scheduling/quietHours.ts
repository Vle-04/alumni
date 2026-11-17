/**
 * Quiet hours in the recipient's time zone. Emails due inside quiet hours are deferred to
 * the end of the quiet period. DST-safe: computed from the zone's wall clock via Intl.
 */
export interface QuietHours {
  startHour: number; // e.g. 21 → quiet from 21:00
  endHour: number; // e.g. 8 → until 08:00
}
export const DEFAULT_QUIET_HOURS: QuietHours = { startHour: 21, endHour: 8 };

function localHourMinute(date: Date, timeZone: string): { hour: number; minute: number } {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(date);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  return { hour: get("hour"), minute: get("minute") };
}

export function isQuiet(date: Date, timeZone: string, q: QuietHours = DEFAULT_QUIET_HOURS): boolean {
  const { hour } = localHourMinute(date, timeZone);
  return q.startHour > q.endHour ? hour >= q.startHour || hour < q.endHour : hour >= q.startHour && hour < q.endHour;
}

/** Returns `date` if allowed, otherwise the first minute after quiet hours end (local time). */
export function nextAllowedSendTime(date: Date, timeZone: string, q: QuietHours = DEFAULT_QUIET_HOURS): Date {
  if (q.startHour === q.endHour) return date; // quiet hours disabled
  let t = new Date(date);
  for (let i = 0; i < 4 && isQuiet(t, timeZone, q); i++) {
    const { hour, minute } = localHourMinute(t, timeZone);
    const hoursUntilEnd = (q.endHour - hour + 24) % 24 || 24;
    t = new Date(t.getTime() + (hoursUntilEnd * 60 - minute) * 60_000);
    t.setUTCSeconds(0, 0);
  }
  // A DST jump inside the quiet period makes the wall-clock arithmetic overshoot by the
  // offset change; step back while the earlier hour is still allowed and after `date`.
  for (let i = 0; i < 2; i++) {
    const earlier = new Date(t.getTime() - 3_600_000);
    if (earlier > date && !isQuiet(earlier, timeZone, q)) t = earlier;
    else break;
  }
  return t;
}

export function safeTimeZone(tz: string | null | undefined, fallback: string): string {
  if (!tz) return fallback;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return tz;
  } catch {
    return fallback;
  }
}
