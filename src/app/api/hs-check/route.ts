import { NextResponse } from 'next/server';
import { SupabaseAcftaStore, SupabaseTradeRemedyRepository } from '@/lib/acfta/supabase-store';
import { createAcftaAdapter } from '@/lib/hs/adapters/acfta';
import { createAdAdapter } from '@/lib/hs/adapters/ad-remedies';
import { createCustomsAdapter } from '@/lib/hs/adapters/customs';
import { runUnifiedCheck } from '@/lib/hs/unified-check';
import { errorResponse, requireUser } from '@/lib/server/context';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  const ctx = await requireUser(req);
  if (ctx instanceof NextResponse) return ctx;
  try {
    const body = (await req.json()) as { hsCode?: string; originCountry?: string; exportingCountry?: string; manufacturer?: string; productDescription?: string };
    const { originCountry, exportingCountry, manufacturer, productDescription } = body;
    const result = await runUnifiedCheck(
      { hsCode: String(body.hsCode ?? ''), context: { originCountry, exportingCountry, manufacturer, productDescription }, userId: ctx.actor.id },
      {
        customs: createCustomsAdapter(), // no verified official integration yet -> MANUAL_CHECK_REQUIRED
        ad: createAdAdapter(new SupabaseTradeRemedyRepository(ctx.sb)),
        acfta: createAcftaAdapter(new SupabaseAcftaStore(ctx.sb)),
        history: {
          async save({ userId, result: r }) {
            const { error } = await ctx.sb.from('hs_check_history').insert({ id: r.id, user_id: userId, hs_code: r.hs.digits, context: r.context, result: r });
            if (error) throw error;
          },
        },
      },
    );
    return NextResponse.json(result);
  } catch (e) {
    return errorResponse(e);
  }
}
