/**
 * Small-group suppression. Any group of 1–4 people is shown as "<5" (k = 5, configurable).
 * Zero is shown as 0. When a published total would let a reader recover a single hidden cell by
 * subtraction, the next-smallest cell is hidden too (secondary/complementary suppression).
 */
export const MIN_CELL = 5;

export interface SafeCell<K extends string = string> {
  key: K;
  n: number | null; // null = suppressed
  display: string;
  suppressed: boolean;
}

export function cell<K extends string>(key: K, n: number, k = MIN_CELL): SafeCell<K> {
  const hide = n > 0 && n < k;
  return { key, n: hide ? null : n, display: hide ? `<${k}` : String(n), suppressed: hide };
}

/** Suppresses a set of cells that add up to a published total. */
export function suppressGroup<K extends string>(cells: readonly { key: K; n: number }[], k = MIN_CELL): SafeCell<K>[] {
  const out = cells.map((c) => cell(c.key, c.n, k));
  const hidden = out.filter((c) => c.suppressed);
  if (hidden.length === 1) {
    // One hidden cell is recoverable as total − visible cells; hide the smallest other non-zero cell.
    const candidates = cells.map((c, i) => ({ ...c, i })).filter((c) => !out[c.i]!.suppressed && c.n > 0).sort((a, b) => a.n - b.n || a.i - b.i);
    const extra = candidates[0];
    if (extra) out[extra.i] = { key: extra.key, n: null, display: "suppressed", suppressed: true };
  }
  return out;
}

export interface SafeRate {
  value: number | null; // 0–1, null when suppressed or undefined
  display: string;
  numerator: string;
  denominator: string;
  suppressed: boolean;
}

/**
 * A rate is shown exactly only when the denominator is at least k AND neither the numerator nor its
 * complement is a small group (1..k-1) — otherwise rate × denominator would reveal a small count.
 * In those cases a BOUND is shown instead ("<10%" / ">76%"), which reveals no more than the
 * corresponding "<k" cell does. Below k in the denominator nothing is shown.
 */
export function safeRate(num: number, den: number, k = MIN_CELL): SafeRate {
  if (den === 0) return { value: null, display: "—", numerator: "0", denominator: "0", suppressed: false };
  const small = (x: number) => x > 0 && x < k;
  const base = { value: null, numerator: cell("n", num, k).display, denominator: cell("d", den, k).display, suppressed: true };
  if (den < k) return { ...base, display: "Group too small" };
  if (small(num)) return { ...base, display: `<${Math.ceil((100 * k) / den)}%` };
  if (small(den - num)) return { ...base, display: `>${Math.floor((100 * (den - k)) / den)}%` };
  return { value: num / den, display: `${Math.round((num / den) * 100)}%`, numerator: String(num), denominator: String(den), suppressed: false };
}
