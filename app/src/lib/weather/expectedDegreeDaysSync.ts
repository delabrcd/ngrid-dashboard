// IMPURE wrapper for the seasonal projection's expected degree-days (issue #52):
// read cached daily history for the climatological normals and delegate the
// arithmetic to the PURE assembleExpectedDegreeDays(). Kept in its own module
// (separate from the pure math) so the math stays unit-testable without a
// DB/Prisma client.

import { prisma } from '@/lib/db';
import {
  assembleExpectedDegreeDays,
  dayOfYearNormals,
  daysInRange,
  overallMean,
} from './expectedDegreeDays';
import { fetchForecastDailyTemps, FORECAST_HORIZON_DAYS, type DailyTemp } from './openMeteo';
import { medianIntervalDays, type ExpectedDegreeDays } from '@/lib/prediction';
import { isoDate as ymd, ymAddMonths } from '@/lib/ym';

const DAY_MS = 24 * 60 * 60 * 1000;

// First/last UTC day of a YYYYMM calendar month.
const ymMonthStart = (ym: number) => new Date(Date.UTC(Math.floor(ym / 100), (ym % 100) - 1, 1));
const ymMonthEnd = (ym: number) => new Date(Date.UTC(Math.floor(ym / 100), ym % 100, 0));

// IMPURE per-future-month NORMAL degree-days for the 12-month seasonal projection
// (issue #52). For each of the 12 calendar months after `latestYm` we sum the
// climatological-NORMAL HDD/CDD over that month's days, from the account's cached
// daily history (day-of-year normals). No forecast: a year out there is none, so
// every day is sourced from normals (or the overall mean as a last resort).
//
// FAILURE-TOLERANT BY DESIGN: never throws. A month we can't source any normal
// for (no history at all) is simply omitted from the map — projectSeason() then
// falls back to that month's same-month-last-year usage. Returns an empty map
// when there's no usable history, which makes the whole season fall back cleanly.
export async function seasonNormalsByMonth(
  accountId: number,
  latestYm: number,
  baseF: number
): Promise<Map<number, ExpectedDegreeDays>> {
  const out = new Map<number, ExpectedDegreeDays>();
  try {
    const dailyRows = await prisma.weatherDaily.findMany({
      where: { accountId },
      select: { date: true, tMean: true },
      orderBy: { date: 'asc' },
    });
    const history = dailyRows.map((d) => ({ date: ymd(d.date), tMean: d.tMean }));
    const normals = dayOfYearNormals(history);
    const overall = overallMean(history);
    if (!normals.size && overall == null) return out; // no usable history

    for (let h = 1; h <= 12; h++) {
      const ym = ymAddMonths(latestYm, h);
      const days = daysInRange(ymMonthStart(ym), ymMonthEnd(ym));
      // No forecast slice for a year-out month — assemble entirely from normals.
      const edd = assembleExpectedDegreeDays(days, [], normals, overall, baseF);
      // Only keep a month we could actually source normals for every (or any) day.
      if (edd.normalDays > 0) out.set(ym, edd);
    }
  } catch {
    // Be resilient: any read error -> empty map -> season falls back cleanly.
    return out;
  }
  return out;
}

// IMPURE expected degree-days for the PREDICTED NEXT-BILL window (issue #67).
// The window runs from the day after the latest bill's period end for the
// median statement interval (~30 days when unknown). Near-term days are sourced
// from the live Open-Meteo forecast (capped at its horizon); the remainder from
// climatological normals built from the account's cached daily history — the
// same forecast+normals assembly #44 used. Returns the window's HDD/CDD plus its
// length in days.
//
// FAILURE-TOLERANT BY DESIGN: never throws. Returns null when we can't build any
// estimate (no bills, no usable history); the forecast fetch failing just falls
// back to normals for the whole window. The caller (getOverview) then falls back
// to the #9 calendar estimate.
export async function nextBillWindowDegreeDays(
  accountId: number,
  baseF: number
): Promise<{ target: ExpectedDegreeDays; targetDays: number } | null> {
  try {
    const account = await prisma.account.findUnique({ where: { id: accountId } });
    if (!account) return null;

    const bills = await prisma.bill.findMany({
      where: { accountId },
      select: { statementDate: true, periodFrom: true, periodTo: true },
      orderBy: { statementDate: 'asc' },
    });
    if (!bills.length) return null;

    // Median statement interval -> predicted window length.
    const medianDays = Math.round(medianIntervalDays(bills.map((b) => b.statementDate)));
    const last = bills[bills.length - 1];
    // Anchor the window after the latest period (fall back to statement date).
    const anchorEnd = last.periodTo ?? last.statementDate;
    const start = new Date(anchorEnd.getTime() + DAY_MS);
    const end = new Date(start.getTime() + (medianDays - 1) * DAY_MS);
    const windowDays = daysInRange(start, end);
    if (!windowDays.length) return null;

    // Climatological normals from cached daily history.
    const dailyRows = await prisma.weatherDaily.findMany({
      where: { accountId },
      select: { date: true, tMean: true },
      orderBy: { date: 'asc' },
    });
    const history = dailyRows.map((d) => ({ date: ymd(d.date), tMean: d.tMean }));
    const normals = dayOfYearNormals(history);
    const overall = overallMean(history);
    if (!normals.size && overall == null) return null;

    // Forecast for the near-term portion of the window (best-effort).
    let forecast: DailyTemp[] = [];
    if (account.latitude != null && account.longitude != null) {
      const horizonEnd = new Date(start.getTime() + (FORECAST_HORIZON_DAYS - 1) * DAY_MS);
      const fcEnd = horizonEnd.getTime() < end.getTime() ? horizonEnd : end;
      try {
        forecast = await fetchForecastDailyTemps(
          { latitude: account.latitude, longitude: account.longitude },
          ymd(start),
          ymd(fcEnd),
          'F'
        );
      } catch {
        forecast = []; // forecast unavailable -> normals cover the whole window
      }
    }

    const target = assembleExpectedDegreeDays(windowDays, forecast, normals, overall, baseF);
    if (target.forecastDays + target.normalDays === 0) return null;
    return { target, targetDays: windowDays.length };
  } catch {
    return null;
  }
}
