import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// DELETE — remove a stored login. Its accounts are kept (the FK is
// onDelete: SetNull), so historical bills/usage survive; they just lose their
// login association and fall back to env-credential scrapes.
export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const id = parseInt(params.id, 10);
  if (Number.isNaN(id)) return NextResponse.json({ error: 'bad id' }, { status: 400 });
  try {
    await prisma.ngLogin.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch {
    // Prisma throws P2025 when the row doesn't exist; treat as already-gone.
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }
}
