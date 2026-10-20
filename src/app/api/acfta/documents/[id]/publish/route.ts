import { NextResponse } from 'next/server';
import { createReviewService } from '@/lib/acfta/review';
import { SupabaseAcftaStore } from '@/lib/acfta/supabase-store';
import { errorResponse, requireUser } from '@/lib/server/context';

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireUser(req);
  if (ctx instanceof NextResponse) return ctx;
  try {
    const body = (await req.json().catch(() => ({}))) as { supersedes?: string };
    await createReviewService(new SupabaseAcftaStore(ctx.sb)).publish(ctx.actor, (await params).id, body.supersedes);
    return NextResponse.json({ ok: true });
  } catch (e) { return errorResponse(e); }
}
