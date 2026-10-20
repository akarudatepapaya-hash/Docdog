import { NextResponse } from 'next/server';
import { errorResponse, requireUser } from '@/lib/server/context';

export async function GET(req: Request) {
  const ctx = await requireUser(req);
  if (ctx instanceof NextResponse) return ctx;
  const { data, error } = await ctx.sb.from('hs_check_history').select('id,hs_code,context,created_at,result').order('created_at', { ascending: false }).limit(50);
  if (error) return errorResponse(error);
  return NextResponse.json({ items: data });
}
