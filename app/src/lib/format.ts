// Client-safe formatting helpers.
import type { YoyFuelResult } from './series';
export const usd = (n: number | null | undefined, dp = 2): string =>
  n == null ? '—' : `$${n.toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp })}`;

export const num = (n: number | null | undefined, dp = 0): string =>
  n == null ? '—' : n.toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp });

export const rate = (n: number | null | undefined, dp = 3): string => (n == null ? '—' : `$${n.toFixed(dp)}`);

export function relativeFromNow(iso: string | null | undefined): string {
  if (!iso) return '—';
  const then = new Date(iso).getTime();
  const diff = Date.now() - then;
  const past = diff >= 0;
  const s = Math.abs(diff) / 1000;
  const units: [number, string][] = [
    [60, 'second'],
    [60, 'minute'],
    [24, 'hour'],
    [7, 'day'],
    [4.345, 'week'],
    [12, 'month'],
    [Number.POSITIVE_INFINITY, 'year'],
  ];
  let v = s;
  let name = 'second';
  for (const [div, label] of units) {
    if (v < div) { name = label; break; }
    v /= div;
    name = label;
  }
  const rounded = Math.round(v);
  const plural = rounded === 1 ? '' : 's';
  return past ? `${rounded} ${name}${plural} ago` : `in ${rounded} ${name}${plural}`;
}

export const dateLabel = (iso: string | null | undefined): string =>
  !iso ? '—' : new Date(iso).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });

// The verbose next-bill-estimate detail moved behind an ⓘ tooltip (issue #38) so
// the card itself stays compact and the word "estimate(d)" is stated ONCE. The
// basis (already a human-readable projection note) is folded into a single
// disclaimer sentence. PURE — unit-tested. Exported for the cockpit and tests.
export const estimateTooltip = (basis: string | null | undefined): string => {
  const b = (basis ?? '').trim();
  return b ? `Estimated from ${b}. Not a real charge.` : 'Estimated. Not a real charge.';
};

// Signed whole-percent label from a fraction (0.062 -> "+6%", -0.071 -> "−7%",
// null -> "—"). Uses a true minus sign to match the rest of the UI.
export const signedPct = (frac: number | null | undefined): string => {
  if (frac == null) return '—';
  const p = Math.round(frac * 100);
  return p > 0 ? `+${p}%` : p < 0 ? `−${Math.abs(p)}%` : '0%';
};

// One-sentence year-over-year weather-normalized verdict for a fuel (issue #47).
// PURE — the arithmetic already happened in compareYoY; this only phrases the
// per-fuel result, e.g. "Electric: +6% kWh, but +14% degree-days — ~7% lower
// after normalizing." Falls back gracefully when a percentage can't be computed
// (zero prior-year base). `unit` is the usage unit ("kWh" / "therms").
export function yoyVerdict(res: YoyFuelResult, fuelLabel: string, unit: string): string {
  const raw = signedPct(res.rawUsagePct);
  const dd = signedPct(res.ddPct);
  // The clause that carries the answer: same magnitude as normalizedPct but
  // phrased as the human takeaway (used less / more / about the same).
  let verdict: string;
  if (res.normalizedPct == null) {
    verdict = 'weather-adjusted change unavailable';
  } else {
    const p = Math.round(res.normalizedPct * 100);
    verdict =
      p < 0 ? `~${Math.abs(p)}% lower once you account for the weather`
        : p > 0 ? `~${p}% higher once you account for the weather`
          : 'about the same once you account for the weather';
  }
  return `${fuelLabel}: ${raw} ${unit}, but ${dd} heating/cooling weather — ${verdict}.`;
}
