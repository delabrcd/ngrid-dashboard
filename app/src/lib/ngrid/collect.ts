// Drive a headless browser to collect the full bill/usage/cost/weather history.
// Strategy (proven): intercept the SPA's own GraphQL requests and only widen
// their date/paging filters, which preserves the app's auth + subscription-key
// headers. Then download any new bill PDFs with those captured headers.
import fs from 'fs';
import path from 'path';
import { chromium } from 'playwright';
import type { Route } from 'playwright';
import { contextOptions, ensureLoggedIn, dataDir, saveState } from './auth';
import { parseBillPdf } from './parsePdf';
import type {
  AccountInfo,
  BillRow,
  CollectResult,
  CostRow,
  ProgressFn,
  UsageRow,
  WeatherRow,
} from './types';

const asArray = (x: any): any[] => (Array.isArray(x?.nodes) ? x.nodes : Array.isArray(x) ? x : []);
const ymd = (d?: string): string | undefined => (d ? d.slice(0, 10) : undefined);
const yyyymm = (d?: string): number => {
  if (!d) return 0;
  const m = d.match(/^(\d{4})-(\d{2})/);
  return m ? parseInt(m[1], 10) * 100 + parseInt(m[2], 10) : 0;
};
const unitFor = (usageType: string): string =>
  /KWH/i.test(usageType) ? 'kWh' : /THERM/i.test(usageType) ? 'therms' : '';

export async function collect(log: ProgressFn = () => {}): Promise<CollectResult> {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const ctx = await browser.newContext(contextOptions());
  const page = await ctx.newPage();

  try {
    await ensureLoggedIn(page, log);
    const accountLink = new URL(page.url()).searchParams.get('accountLink') || undefined;

    // Capture buckets.
    const cap: Record<string, any> = {};
    const authHeaders: Record<string, string> = {};
    let haveAuth = false;
    let accountNumber: string | undefined;
    let companyCode: string | undefined;
    let weatherRegion: string | undefined;

    // Widen filters + capture auth headers / identifiers from the app's requests.
    await page.route('**/api/**-gql', async (route: Route) => {
      const req = route.request();
      const h = req.headers();
      let post = req.postData() || '';
      try {
        const j = JSON.parse(post);
        const v = j.variables || {};
        if (v.accountNumber) accountNumber = v.accountNumber;
        if (v.companyCode) companyCode = v.companyCode;
        if (v.region) weatherRegion = v.region;
        // Widen only the filters we've verified are safe. The bills query takes a
        // floor date; the energy-usage query pages by numeric YYYYMM `from` + `first`.
        // Do NOT touch the weather query's string `from` / `last` — widening those
        // makes that endpoint return an empty set.
        if ('dateForNumberOfDaysAgo' in v) v.dateForNumberOfDaysAgo = '2000-01-01';
        if (typeof v.from === 'number') v.from = 200001; // YYYYMM, far past
        if (typeof v.first === 'number') v.first = 1000;
        j.variables = v;
        post = JSON.stringify(j);
      } catch {
        /* leave body unchanged */
      }
      if (!haveAuth && h.authorization && h['ocp-apim-subscription-key']) {
        authHeaders.authorization = h.authorization;
        authHeaders['ocp-apim-subscription-key'] = h['ocp-apim-subscription-key'];
        authHeaders.origin = 'https://myaccount.nationalgrid.com';
        haveAuth = true;
      }
      await route.continue({ postData: post });
    });

    // Capture responses by their data keys.
    page.on('response', async (resp) => {
      const url = resp.url();
      if (!/\/api\/[a-z-]+-gql/.test(url)) return;
      let json: any;
      try {
        json = await resp.json();
      } catch {
        return;
      }
      const data = json?.data;
      if (!data) return;
      if (process.env.SCRAPE_DEBUG) console.log('[collect] gql keys:', Object.keys(data).join('+'));
      if (data.Bills) cap.bills = asArray(data.Bills);
      if (data.energyUsages) cap.usages = asArray(data.energyUsages);
      if (data.energyUsageCosts) cap.costs = asArray(data.energyUsageCosts);
      if (data.energyUsageBillAmounts) cap.billAmounts = asArray(data.energyUsageBillAmounts);
      if (data.weather) cap.weather = asArray(data.weather);
      if (data.billingAccount) cap.account = data.billingAccount;
      if (data.user) cap.user = data.user;
    });

    const base = 'https://myaccount.nationalgrid.com';
    const q = accountLink ? `?accountLink=${accountLink}` : '';
    // Visit each data page WITH the capture handlers attached. The dashboard is
    // re-visited here because some queries (weather, per-fuel bill amounts) fire
    // on it and would otherwise be missed during the initial login navigation.
    for (const [name, route] of [
      ['dashboard', '/dashboard'],
      ['bill history', '/bill-history'],
      ['energy usage', '/energy-usage'],
    ] as const) {
      log(`loading ${name}`);
      await page.goto(`${base}${route}${q}`, { waitUntil: 'networkidle', timeout: 30000 }).catch(() => {});
      await page.waitForTimeout(4000);
    }
    // Re-save session in case tokens were refreshed during navigation.
    await saveState(ctx).catch(() => {});

    if (!accountNumber) throw new Error('Could not determine the account number from the portal.');

    // ---- normalize ---------------------------------------------------------
    const rawAddr = cap.account?.serviceAddress;
    const serviceAddress =
      typeof rawAddr === 'string'
        ? rawAddr
        : rawAddr?.serviceAddressCompressed ||
          rawAddr?.compressed ||
          (rawAddr ? JSON.stringify(rawAddr) : undefined);
    const fuelTypes = (Array.isArray(cap.account?.fuelTypes) ? cap.account.fuelTypes : [])
      .map((f: any) => (typeof f === 'string' ? f : f?.type))
      .filter(Boolean);

    const acct: AccountInfo = {
      accountNumber,
      accountLink,
      companyCode,
      region: cap.account?.region || weatherRegion,
      serviceAddress,
      fuelTypes,
      premiseNumber: cap.account?.premiseNumber ? String(cap.account.premiseNumber) : undefined,
      customerNumber: cap.account?.customerNumber ? String(cap.account.customerNumber) : undefined,
    };

    const bills: BillRow[] = (cap.bills || []).map((b: any) => ({
      statementDate: ymd(b.statementDate)!,
      periodFrom: ymd(b.billDuration?.fromDate),
      periodTo: ymd(b.billDuration?.toDate),
      totalDueAmount: typeof b.totalDueAmount === 'number' ? b.totalDueAmount : undefined,
      status: b.status,
      usageTypes: asArray(b.energyUsages).map((n: any) => n.usageType).filter(Boolean),
    }));

    const usage: UsageRow[] = (cap.usages || []).map((u: any) => ({
      usageType: u.usageType,
      periodYearMonth: typeof u.usageYearMonth === 'number' ? u.usageYearMonth : yyyymm(u.dateFrom),
      dateFrom: ymd(u.dateFrom),
      dateTo: ymd(u.dateTo),
      quantity: Number(u.usage) || 0,
      unit: unitFor(u.usageType),
    }));

    // Per-fuel supply/delivery costs come from the bill PDFs (full history) — the
    // API's energyUsageCosts/energyUsageBillAmounts only cover ~24 months. Built
    // in the PDF loop below.
    const costRows: CostRow[] = [];

    // Weather has one row per fuelType per month; collapse to one temp per month.
    const weatherByMonth = new Map<string, WeatherRow>();
    for (const w of cap.weather || []) {
      const monthYear = ymd(w.applicableMonthYear);
      if (!monthYear) continue;
      if (!weatherByMonth.has(monthYear))
        weatherByMonth.set(monthYear, {
          region: w.region || weatherRegion || acct.region || 'UNKNOWN',
          monthYear,
          avgTemperature: Number(w.averageTemperature),
          unit: w.measureUnit || 'F',
        });
    }
    const weather = [...weatherByMonth.values()];

    // ---- download new PDFs --------------------------------------------------
    let pdfsDownloaded = 0;
    let parseFailures = 0;
    if (haveAuth) {
      const pdfDir = path.join(dataDir(), 'pdfs', accountNumber);
      fs.mkdirSync(pdfDir, { recursive: true });
      const headers = { ...authHeaders, 'account-number': accountNumber };
      log(`downloading PDFs (${bills.length} bills)`);
      for (const b of bills) {
        const dest = path.join(pdfDir, `${b.statementDate}.pdf`);
        if (fs.existsSync(dest) && fs.statSync(dest).size > 1000) {
          b.pdfPath = dest;
        } else {
          const url = `https://myaccount.nationalgrid.com/api/bill-cu-uwp-sys/v1/bills/view-pdf/${b.statementDate}`;
          let saved = false;
          for (let attempt = 1; attempt <= 3 && !saved; attempt++) {
            try {
              const r = await ctx.request.get(url, { headers, timeout: 30000 });
              const ctype = (r.headers()['content-type'] || '').toLowerCase();
              if (r.ok() && ctype.includes('pdf')) {
                fs.writeFileSync(dest, await r.body());
                b.pdfPath = dest;
                saved = true;
                pdfsDownloaded++;
              } else if (r.status() < 500) {
                break;
              }
            } catch {
              await page.waitForTimeout(1200);
            }
          }
        }

        // Parse the per-fuel supply/delivery breakdown + period charges from the PDF.
        if (b.pdfPath) {
          const d = await parseBillPdf(b.pdfPath);
          if (d) {
            b.currentCharges = d.currentCharges ?? undefined;
            const ym = yyyymm(b.statementDate);
            const add = (fuelType: string, kind: 'SUPPLY' | 'DELIVERY', amount: number | null) => {
              if (amount != null) costRows.push({ fuelType, kind, periodYearMonth: ym, dateFrom: b.periodFrom, dateTo: b.periodTo, amount });
            };
            add('ELECTRIC', 'SUPPLY', d.electric.supply);
            add('ELECTRIC', 'DELIVERY', d.electric.delivery);
            add('GAS', 'SUPPLY', d.gas.supply);
            add('GAS', 'DELIVERY', d.gas.delivery);
          } else {
            parseFailures++;
          }
        }
      }
      if (parseFailures) log(`warning: ${parseFailures} PDFs had no parseable breakdown`);
    } else {
      log('warning: no auth headers captured; skipping PDF download');
    }

    return { account: acct, bills, usage, costs: costRows, weather, pdfsDownloaded };
  } finally {
    await browser.close();
  }
}
