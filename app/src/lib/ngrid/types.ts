// Normalized shapes produced by the scraper (collect.ts) and consumed by persist.ts.

export interface AccountInfo {
  accountNumber: string;
  accountLink?: string;
  region?: string;
  companyCode?: string;
  serviceAddress?: string;
  fuelTypes: string[];
  premiseNumber?: string;
  customerNumber?: string;
}

export interface BillRow {
  statementDate: string; // YYYY-MM-DD
  periodFrom?: string;
  periodTo?: string;
  totalDueAmount?: number; // statement "Amount Due" (from the API)
  currentCharges?: number; // this period's energy charges (from the PDF) — used for cost analysis
  status?: string;
  usageTypes: string[];
  pdfPath?: string;
}

export interface UsageRow {
  usageType: string; // TOTAL_KWH | THERMS
  periodYearMonth: number; // e.g. 202605
  dateFrom?: string;
  dateTo?: string;
  quantity: number;
  unit: string; // kWh | therms
}

export interface CostRow {
  fuelType: string; // ELECTRIC | GAS
  kind: 'SUPPLY' | 'DELIVERY';
  periodYearMonth: number;
  dateFrom?: string;
  dateTo?: string;
  amount: number;
}

export interface WeatherRow {
  region: string;
  monthYear: string; // YYYY-MM-DD (first of month)
  avgTemperature: number;
  unit: string;
}

export interface CollectResult {
  account: AccountInfo;
  bills: BillRow[];
  usage: UsageRow[];
  costs: CostRow[];
  weather: WeatherRow[];
  pdfsDownloaded: number;
}

export type ProgressFn = (msg: string) => void;
