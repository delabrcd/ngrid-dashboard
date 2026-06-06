// Declarative spec for each dashboard chart. The generic renderer in
// ConfigurableChart.tsx turns these into Recharts charts and the config menu is
// derived from them, so adding/altering a chart is a data change here.

export interface MonthRow {
  ym: number;
  label: string;
  kwh: number | null;
  therms: number | null;
  elecSupply: number | null;
  gasSupply: number | null;
  elecDelivery: number | null;
  gasDelivery: number | null;
  elecBill?: number | null;
  gasBill?: number | null;
  elecRateSupply: number | null;
  gasRateSupply: number | null;
  elecRateAllIn: number | null;
  gasRateAllIn: number | null;
  avgTemp: number | null;
  billTotal: number | null;
}

export type SeriesKey = Exclude<keyof MonthRow, 'ym' | 'label'>;

export interface SeriesDef {
  key: SeriesKey;
  label: string;
  color: string;
  role: 'bar' | 'line';
  axis: 'left' | 'right';
  dash?: boolean;
}

export interface ChartSpec {
  id: string;
  title: string;
  subtitle?: string;
  series: SeriesDef[];
  leftFmt?: (v: number) => string;
  rightFmt?: (v: number) => string;
  filter: (r: MonthRow) => boolean;
}

const ELEC = '#f59e0b';
const ELEC_SOFT = '#fcd34d';
const GAS = '#38bdf8';
const GAS_SOFT = '#7dd3fc';
const TEMP = '#fb7185';
const TOTAL = '#e2e8f0';

const money = (v: number) => `$${v}`;
const money2 = (v: number) => `$${(+v).toFixed(2)}`;
const deg = (v: number) => `${v}°`;

export const CHART_SPECS: ChartSpec[] = [
  {
    id: 'usage',
    title: 'Energy usage',
    subtitle: 'Electricity (kWh) and gas (therms) per month',
    series: [
      { key: 'kwh', label: 'kWh', color: ELEC, role: 'bar', axis: 'left' },
      { key: 'therms', label: 'therms', color: GAS, role: 'bar', axis: 'right' },
    ],
    filter: (r) => r.kwh != null || r.therms != null,
  },
  {
    id: 'cost',
    title: 'Cost breakdown',
    subtitle: 'Supply vs delivery per fuel, with total bill',
    series: [
      { key: 'elecSupply', label: 'Elec supply', color: ELEC, role: 'bar', axis: 'left' },
      { key: 'elecDelivery', label: 'Elec delivery', color: ELEC_SOFT, role: 'bar', axis: 'left' },
      { key: 'gasSupply', label: 'Gas supply', color: GAS, role: 'bar', axis: 'left' },
      { key: 'gasDelivery', label: 'Gas delivery', color: GAS_SOFT, role: 'bar', axis: 'left' },
      { key: 'billTotal', label: 'Total bill', color: TOTAL, role: 'line', axis: 'left' },
    ],
    leftFmt: money,
    filter: (r) => r.elecSupply != null || r.gasSupply != null || r.billTotal != null,
  },
  {
    id: 'rates',
    title: 'Effective rates',
    subtitle: 'Supply rate (solid) and all-in rate (dashed)',
    series: [
      { key: 'elecRateSupply', label: 'Elec $/kWh', color: ELEC, role: 'line', axis: 'left' },
      { key: 'elecRateAllIn', label: 'Elec $/kWh all-in', color: ELEC, role: 'line', axis: 'left', dash: true },
      { key: 'gasRateSupply', label: 'Gas $/therm', color: GAS, role: 'line', axis: 'right' },
      { key: 'gasRateAllIn', label: 'Gas $/therm all-in', color: GAS, role: 'line', axis: 'right', dash: true },
    ],
    leftFmt: money2,
    rightFmt: money2,
    filter: (r) => r.elecRateSupply != null || r.gasRateSupply != null,
  },
  {
    id: 'weather',
    title: 'Usage vs weather',
    subtitle: 'Monthly avg temperature against energy use',
    series: [
      { key: 'kwh', label: 'kWh', color: ELEC, role: 'bar', axis: 'left' },
      { key: 'therms', label: 'therms', color: GAS, role: 'bar', axis: 'left' },
      { key: 'avgTemp', label: 'Avg °F', color: TEMP, role: 'line', axis: 'right' },
    ],
    rightFmt: deg,
    filter: (r) => r.avgTemp != null && (r.kwh != null || r.therms != null),
  },
];

export const SPEC_BY_ID: Record<string, ChartSpec> = Object.fromEntries(CHART_SPECS.map((s) => [s.id, s]));

export function chartCaps(spec: ChartSpec) {
  const bars = spec.series.filter((s) => s.role === 'bar').length;
  const hasRight = spec.series.some((s) => s.axis === 'right');
  return { canType: bars > 0, canStack: bars > 1, hasRight };
}
