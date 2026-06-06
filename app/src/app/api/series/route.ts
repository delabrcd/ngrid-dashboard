import { NextResponse } from 'next/server';
import { getDefaultAccount, getMonthlySeries } from '@/lib/queries';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  const acct = await getDefaultAccount();
  if (!acct) return NextResponse.json({ rows: [] });
  return NextResponse.json({ rows: await getMonthlySeries(acct.id) });
}
