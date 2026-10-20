import { NextResponse } from 'next/server';
import { createReviewService } from '@/lib/acfta/review';
import { SupabaseAcftaStore } from '@/lib/acfta/supabase-store';
import type { EditableFields } from '@/lib/acfta/types';
import { errorResponse, requireUser } from '@/lib/server/context';

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireUser(req);
  if (ctx instanceof NextResponse) return ctx;
  try {
    const { id } = await params;
    const body = (await req.json()) as { action: 'approve' | 'reject' | 'edit'; note?: string; fields?: EditableFields };
    const svc = createReviewService(new SupabaseAcftaStore(ctx.sb));
    if (body.action === 'approve') return NextResponse.json(await svc.approve(ctx.actor, id, body.note));
    if (body.action === 'reject') return NextResponse.json(await svc.reject(ctx.actor, id, body.note));
    if (body.action === 'edit' && body.fields) return NextResponse.json(await svc.edit(ctx.actor, id, body.fields, body.note));
    return NextResponse.json({ error: 'action ไม่ถูกต้อง' }, { status: 400 });
  } catch (e) { return errorResponse(e); }
}
