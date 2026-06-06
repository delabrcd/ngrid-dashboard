import { NextResponse } from 'next/server';
import { submitOtp } from '@/lib/ngrid/preflight';
import { validateOtp } from '@/lib/ngrid/preflightState';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// POST — submit the one-time code for a parked pre-flight. One-shot: the code is
// validated, handed to the live login, and never stored or logged. Poll the
// pre-flight GET afterwards for the terminal SUCCESS/ERROR.
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const body = await req.json().catch(() => null);
  const v = validateOtp((body as { code?: unknown })?.code);
  if (!v.ok || !v.code) return NextResponse.json({ error: v.error }, { status: 400 });

  const res = submitOtp(params.id, v.code);
  if (!res.ok) {
    // Expired/unknown attempt → 404; wrong state / duplicate → 409.
    const expired = /expired/i.test(res.error || '');
    return NextResponse.json({ error: res.error }, { status: expired ? 404 : 409 });
  }
  return NextResponse.json({ status: res.view?.status, message: res.view?.message });
}
