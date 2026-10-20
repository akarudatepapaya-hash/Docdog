import { NextResponse } from 'next/server';
import { ingestAcftaPdf } from '@/lib/acfta/ingest';
import { pdfjsExtractor } from '@/lib/acfta/pdf-extract';
import { SupabaseAcftaStore, SupabaseBlobStore } from '@/lib/acfta/supabase-store';
import { errorResponse, requireUser } from '@/lib/server/context';

export const runtime = 'nodejs';
export const maxDuration = 60; // large PDFs should move to a background job (see README)

export async function GET(req: Request) {
  const ctx = await requireUser(req);
  if (ctx instanceof NextResponse) return ctx;
  try { return NextResponse.json({ items: await new SupabaseAcftaStore(ctx.sb).listDocuments() }); } catch (e) { return errorResponse(e); }
}

export async function POST(req: Request) {
  const ctx = await requireUser(req);
  if (ctx instanceof NextResponse) return ctx;
  try {
    const form = await req.formData();
    const file = form.get('file');
    if (!(file instanceof File)) return NextResponse.json({ error: 'ต้องแนบไฟล์ PDF' }, { status: 400 });
    const report = await ingestAcftaPdf(
      { actor: ctx.actor, bytes: new Uint8Array(await file.arrayBuffer()), name: String(form.get('name') ?? ''), version: String(form.get('version') ?? '') },
      { store: new SupabaseAcftaStore(ctx.sb), blobs: new SupabaseBlobStore(ctx.sb), extractor: pdfjsExtractor /* OCR: not configured */ },
    );
    return NextResponse.json(report, { status: 201 });
  } catch (e) { return errorResponse(e); }
}
