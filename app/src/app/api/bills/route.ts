import { NextResponse } from 'next/server';
import { getBills, getDefaultAccount } from '@/lib/queries';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  const acct = await getDefaultAccount();
  if (!acct) return NextResponse.json({ bills: [] });
  return NextResponse.json({ bills: await getBills(acct.id) });
}
