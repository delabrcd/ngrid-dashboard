import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  const runs = await prisma.scrapeRun.findMany({ orderBy: { startedAt: 'desc' }, take: 12 });
  return NextResponse.json({
    runs: runs.map((r) => ({
      id: r.id,
      trigger: r.trigger,
      status: r.status,
      startedAt: r.startedAt.toISOString(),
      finishedAt: r.finishedAt?.toISOString() ?? null,
      billsAdded: r.billsAdded,
      message: r.message,
    })),
  });
}
