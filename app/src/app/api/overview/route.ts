import { NextResponse } from 'next/server';
import { getDefaultAccount, getOverview } from '@/lib/queries';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  const acct = await getDefaultAccount();
  if (!acct) return NextResponse.json({ empty: true });
  return NextResponse.json(await getOverview(acct.id));
}
