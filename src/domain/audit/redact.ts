/**
 * Builds before/after diffs for the audit log. Contact fields are never written to the
 * audit log in clear text — only the fact that they changed — so the audit log does not
 * become a second copy of personal data.
 */
export const CONTACT_FIELDS = new Set([
  "email", "emailEnc", "emailHash", "phone", "phoneEnc", "linkedinUrl", "linkedinUrlEnc",
]);
/** Other identifying fields: also logged only as "changed", never by value. */
export const PERSONAL_FIELDS = new Set(["fullName", "preferredName", "city", "country", "timezone", "notes", "note"]);
const REDACTED = new Set([...CONTACT_FIELDS, ...PERSONAL_FIELDS]);

/**
 * Deep-scrubs an already-stored audit payload: redacts personal keys and replaces any string
 * containing one of `needles` (e.g. a deleted person's name or email). Used on deletion.
 */
export function scrubAuditPayload(value: unknown, needles: readonly string[]): unknown {
  const lower = needles.filter((n) => n.trim().length >= 3).map((n) => n.toLowerCase());
  const walk = (v: unknown, key?: string): unknown => {
    if (key && REDACTED.has(key)) return { changed: true };
    if (typeof v === "string") return lower.some((n) => v.toLowerCase().includes(n)) ? "[removed]" : v;
    if (Array.isArray(v)) return v.map((x) => walk(x));
    if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x, k)]));
    return v;
  };
  return walk(value);
}

export type AuditDiff = Record<string, { before?: unknown; after?: unknown; changed?: true }>;

function same(a: unknown, b: unknown): boolean {
  if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime();
  return JSON.stringify(a) === JSON.stringify(b);
}

export function auditDiff(before: Record<string, unknown> | null, after: Record<string, unknown> | null): AuditDiff {
  const keys = new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})]);
  const diff: AuditDiff = {};
  for (const k of keys) {
    if (k === "updatedAt" || k === "createdAt") continue;
    const b = before?.[k];
    const a = after?.[k];
    if (same(a, b)) continue;
    diff[k] = REDACTED.has(k) ? { changed: true } : { before: b ?? null, after: a ?? null };
  }
  return diff;
}
