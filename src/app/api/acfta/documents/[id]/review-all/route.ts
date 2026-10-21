import { NextResponse } from 'next/server';
import { createReviewService } from '@/lib/acfta/review';
import { SupabaseAcftaStore } from '@/lib/acfta/supabase-store';
import { errorResponse, requireUser } from '@/lib/server/context';

export const maxDuration = 60;

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireUser(req);
  if (ctx instanceof NextResponse) return ctx;
  try {
    const body = (await req.json()) as { status?: 'APPROVED' | 'REJECTED'; confidence?: 'LOW' | 'MEDIUM' };
    if (body.status !== 'APPROVED' && body.status !== 'REJECTED') return NextResponse.json({ error: 'status ไม่ถูกต้อง' }, { status: 400 });
    const changed = await createReviewService(new SupabaseAcftaStore(ctx.sb)).decideAll(ctx.actor, (await params).id, body.status, { confidence: body.confidence });
    return NextResponse.json({ changed });
  } catch (e) { return errorResponse(e); }
}
