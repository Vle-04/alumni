/** Small, dependency-free statistics helpers shared by referral and outcome metrics. */
export function quantile(sortedAsc: readonly number[], q: number): number | null {
  if (sortedAsc.length === 0) return null;
  const pos = (sortedAsc.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sortedAsc[lo]! + (sortedAsc[hi]! - sortedAsc[lo]!) * (pos - lo);
}

export function median(values: readonly number[]): number | null {
  return quantile([...values].sort((a, b) => a - b), 0.5);
}

export const DAY_MS = 86_400_000;
export const daysBetween = (a: Date, b: Date) => (b.getTime() - a.getTime()) / DAY_MS;
