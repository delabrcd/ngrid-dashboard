import fs from 'fs';
import { NextResponse } from 'next/server';
import { getDefaultAccount } from '@/lib/queries';
import { prisma } from '@/lib/db';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(_req: Request, { params }: { params: { date: string } }) {
  const acct = await getDefaultAccount();
  if (!acct) return new NextResponse('No account', { status: 404 });

  const statementDate = new Date(params.date + 'T00:00:00Z');
  const bill = await prisma.bill.findUnique({
    where: { accountId_statementDate: { accountId: acct.id, statementDate } },
  });
  if (!bill?.pdfPath || !fs.existsSync(bill.pdfPath)) {
    return new NextResponse('PDF not found', { status: 404 });
  }
  const buf = fs.readFileSync(bill.pdfPath);
  return new NextResponse(buf, {
    headers: {
      'content-type': 'application/pdf',
      'content-disposition': `inline; filename="national-grid-${params.date}.pdf"`,
      'cache-control': 'private, max-age=86400',
    },
  });
}
