import { NextResponse } from 'next/server';
import { SupabaseAcftaStore } from '@/lib/acfta/supabase-store';
import type { ReviewStatus } from '@/lib/acfta/types';
import { errorResponse, requireUser } from '@/lib/server/context';

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireUser(req);
  if (ctx instanceof NextResponse) return ctx;
  try {
    const status = new URL(req.url).searchParams.get('status') as ReviewStatus | null;
    return NextResponse.json({ items: await new SupabaseAcftaStore(ctx.sb).listRecords((await params).id, status ?? undefined) });
  } catch (e) { return errorResponse(e); }
}
