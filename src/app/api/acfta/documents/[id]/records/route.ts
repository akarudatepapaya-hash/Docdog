import { NextResponse } from 'next/server';
import { SupabaseAcftaStore } from '@/lib/acfta/supabase-store';
import type { RecordQuery } from '@/lib/acfta/types';
import { errorResponse, requireUser } from '@/lib/server/context';

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireUser(req);
  if (ctx instanceof NextResponse) return ctx;
  try {
    const sp = new URL(req.url).searchParams;
    const opts: RecordQuery = {
      status: (sp.get('status') as RecordQuery['status']) || undefined,
      confidence: (sp.get('confidence') as RecordQuery['confidence']) || undefined,
      q: sp.get('q') || undefined,
      limit: Math.min(Number(sp.get('limit') ?? 100) || 100, 500),
      offset: Number(sp.get('offset') ?? 0) || 0,
    };
    const store = new SupabaseAcftaStore(ctx.sb);
    const id = (await params).id;
    const [items, total, pending, approved, rejected, low] = await Promise.all([
      store.listRecords(id, opts), store.countRecords(id, opts),
      store.countRecords(id, { status: 'PENDING' }), store.countRecords(id, { status: 'APPROVED' }),
      store.countRecords(id, { status: 'REJECTED' }), store.countRecords(id, { status: 'PENDING', confidence: 'LOW' }),
    ]);
    return NextResponse.json({ items, total, counts: { pending, approved, rejected, pendingLow: low } });
  } catch (e) { return errorResponse(e); }
}
