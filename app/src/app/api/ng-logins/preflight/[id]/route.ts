import { NextResponse } from 'next/server';
import { getPreflight } from '@/lib/ngrid/preflight';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// GET — poll a pre-flight's status. Returns {status, message}. 404 once the
// entry has been swept (idle timeout) or never existed. Carries nothing secret.
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const view = getPreflight(params.id);
  if (!view) return NextResponse.json({ error: 'not found' }, { status: 404 });
  return NextResponse.json({ status: view.status, message: view.message });
}
