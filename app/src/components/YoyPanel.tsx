'use client';

// Year-over-year weather-normalized verdict panel (issue #47). Answers "did I
// actually use less this year, or was it just milder?" by separating the weather
// effect from a genuine intensity (behaviour) change. ALL arithmetic happens
// server-side in the pure compareYoY (lib/series.ts); this component only renders
// the result it's handed — the headline sentence (lib/format.ts yoyVerdict) plus
// a small raw / weather / normalized breakdown and an honest current-rate cost
// figure (currentCharges-sourced, never totalDueAmount).
import type { YoyResult } from '@/lib/series';
import { num, usd, signedPct, yoyVerdict } from '@/lib/format';

// Per-fuel display metadata: label, usage unit, and the accent the rest of the
// dashboard already uses for that fuel (amber = electric, sky = gas).
const FUELS = [
  { key: 'elec', label: 'Electric', unit: 'kWh', accent: 'text-amber-400' },
  { key: 'gas', label: 'Gas', unit: 'therms', accent: 'text-sky-400' },
] as const;

export function YoyPanel({ yoy, currencyDecimals = 0 }: { yoy: YoyResult | null | undefined; currencyDecimals?: number }) {
  if (!yoy) return null;
  const rows = FUELS.map((f) => ({ ...f, res: yoy[f.key] })).filter((f) => f.res != null);
  if (rows.length === 0) return null;

  return (
    <div className="card relative !p-3">
      <div className="card-title flex items-center gap-1 text-xs">
        This year vs last (weather-normalized)
        <span
          tabIndex={0}
          role="img"
          aria-label="Compares the trailing 12 months against the prior year. Raw usage change is split into the part explained by warmer/colder weather (degree-days) and the part that's a genuine usage change, by comparing each period's usage per degree-day. The cost figure prices the intensity change at your current all-in rate (from bill PDF current charges) — it isolates the usage story from weather and rate changes; it is not a real charge."
          title="Compares the trailing 12 months against the prior year. Raw usage change is split into the part explained by warmer/colder weather (degree-days) and the part that's a genuine usage change, by comparing each period's usage per degree-day. The cost figure prices the intensity change at your current all-in rate (from bill PDF current charges) — it isolates the usage story from weather and rate changes; it is not a real charge."
          className="inline-flex h-4 w-4 cursor-help items-center justify-center rounded-full border border-slate-600/70 text-[10px] font-semibold text-slate-400 transition hover:border-slate-400 hover:text-slate-200 focus:outline-none focus:ring-1 focus:ring-amber-500/60"
        >
          i
        </span>
      </div>
      <div className="mt-2 space-y-3">
        {rows.map(({ key, label, unit, accent, res }) => {
          const r = res!; // filtered non-null above
          return (
            <div key={key} className="border-t border-slate-800/60 pt-2 first:border-0 first:pt-0">
              <p className="text-sm text-slate-200">
                <span className={`font-semibold ${accent}`}>{yoyVerdict(r, label, unit)}</span>
              </p>
              <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-[11px] text-slate-500">
                <span>Raw {signedPct(r.rawUsagePct)} ({num(Math.round(r.rawUsageDelta))} {unit})</span>
                <span>Weather {num(Math.round(r.weatherExplainedDelta))} {unit}</span>
                <span>Behaviour {num(Math.round(r.intensityDelta))} {unit}</span>
                {r.normCostDelta != null && (
                  <span>
                    Normalized cost{' '}
                    <span className={r.normCostDelta < 0 ? 'text-emerald-400' : r.normCostDelta > 0 ? 'text-rose-400' : ''}>
                      {r.normCostDelta < 0 ? '−' : r.normCostDelta > 0 ? '+' : ''}
                      {usd(Math.abs(r.normCostDelta), currencyDecimals)}
                    </span>{' '}
                    at current rates
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
