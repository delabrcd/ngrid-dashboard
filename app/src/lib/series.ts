// Pure aggregation + rate math, independent of the database so it can be unit
// tested with hand-calculated inputs. queries.ts feeds it DB rows; the dashboard
// uses trailing12AllIn for the headline rate cards.
import type { MonthRow } from './chartSpec';

export interface UsageInput { periodYearMonth: number; usageType: string; quantity: number }
export interface CostInput { periodYearMonth: number; fuelType: string; kind: string; amount: number }
export interface WeatherInput { ym: number; avgTemperature: number }
export interface BillInput { ym: number; totalDueAmount: number | null }

export interface SeriesInput {
  usages: UsageInput[];
  costs: CostInput[];
  weather: WeatherInput[];
  bills: BillInput[];
}

const labelFor = (ym: number) => `${Math.floor(ym / 100)}-${String(ym % 100).padStart(2, '0')}`;
const div = (a: number | null, b: number | null) => (a != null && b != null && b > 0 ? a / b : null);
const sum = (a: number | null, b: number | null) => (a == null && b == null ? null : (a ?? 0) + (b ?? 0));

export function deriveMonthlySeries(input: SeriesInput): MonthRow[] {
  const months = new Map<number, MonthRow>();
  const get = (ym: number): MonthRow => {
    let r = months.get(ym);
    if (!r) {
      r = {
        ym, label: labelFor(ym),
        kwh: null, therms: null,
        elecSupply: null, gasSupply: null, elecDelivery: null, gasDelivery: null,
        elecBill: null, gasBill: null,
        elecRateSupply: null, gasRateSupply: null, elecRateAllIn: null, gasRateAllIn: null,
        avgTemp: null, billTotal: null,
      };
      months.set(ym, r);
    }
    return r;
  };

  for (const u of input.usages) {
    if (!u.periodYearMonth) continue;
    const r = get(u.periodYearMonth);
    if (/KWH/i.test(u.usageType)) r.kwh = u.quantity;
    else if (/THERM/i.test(u.usageType)) r.therms = u.quantity;
  }
  for (const c of input.costs) {
    if (!c.periodYearMonth) continue;
    const r = get(c.periodYearMonth);
    const elec = /ELEC/i.test(c.fuelType);
    if (c.kind === 'SUPPLY') elec ? (r.elecSupply = c.amount) : (r.gasSupply = c.amount);
    else if (c.kind === 'DELIVERY') elec ? (r.elecDelivery = c.amount) : (r.gasDelivery = c.amount);
  }
  for (const w of input.weather) get(w.ym).avgTemp = w.avgTemperature;
  for (const b of input.bills) if (b.totalDueAmount != null) get(b.ym).billTotal = b.totalDueAmount;

  for (const r of months.values()) {
    r.elecBill = sum(r.elecSupply, r.elecDelivery);
    r.gasBill = sum(r.gasSupply, r.gasDelivery);
    r.elecRateSupply = div(r.elecSupply, r.kwh);
    r.gasRateSupply = div(r.gasSupply, r.therms);
    r.elecRateAllIn = div(r.elecBill, r.kwh);
    r.gasRateAllIn = div(r.gasBill, r.therms);
  }

  return [...months.values()].sort((a, b) => a.ym - b.ym);
}

// Effective all-in $/unit over the most recent 12 months that have data:
// total (supply + delivery) cost divided by total usage.
export function trailing12AllIn(rows: MonthRow[], fuel: 'elec' | 'gas'): number | null {
  const billKey: 'elecBill' | 'gasBill' = fuel === 'elec' ? 'elecBill' : 'gasBill';
  const useKey: 'kwh' | 'therms' = fuel === 'elec' ? 'kwh' : 'therms';
  const withData = rows.filter((r) => r[billKey] != null && r[useKey] != null && (r[useKey] as number) > 0);
  const last = withData.slice(-12);
  let cost = 0;
  let use = 0;
  for (const r of last) {
    cost += r[billKey] as number;
    use += r[useKey] as number;
  }
  return use > 0 ? cost / use : null;
}
