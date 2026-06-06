import { NextResponse } from 'next/server';
import { verifyAll } from '@/lib/ngrid/verify';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 120;

// Re-parses every stored bill PDF and cross-checks the API-sourced numbers
// (bill total, usage) and stored costs against it. ?fails=1 returns only the
// failing bills.
export async function GET(req: Request) {
  const report = await verifyAll();
  const failsOnly = new URL(req.url).searchParams.get('fails') === '1';
  if (failsOnly) {
    return NextResponse.json({ ...report, bills: report.bills.filter((b) => !b.ok) });
  }
  return NextResponse.json(report);
}
