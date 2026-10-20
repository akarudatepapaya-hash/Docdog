import { NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { userClient } from '../supabase/clients';
import { ForbiddenError, InvalidUploadError } from '../acfta/ingest';
import { StateError } from '../acfta/review';
import { InvalidHsCodeError } from '../hs/normalize';
import type { Actor, Role } from '../acfta/types';

export interface RequestContext { sb: SupabaseClient; actor: Actor }

/** Resolves the caller from the bearer token. RLS applies to every query made with ctx.sb. */
export async function requireUser(req: Request): Promise<RequestContext | NextResponse> {
  const token = /^Bearer (.+)$/.exec(req.headers.get('authorization') ?? '')?.[1];
  if (!token) return NextResponse.json({ error: 'UNAUTHENTICATED' }, { status: 401 });
  const sb = userClient(token);
  const { data, error } = await sb.auth.getUser(token);
  if (error || !data.user) return NextResponse.json({ error: 'UNAUTHENTICATED' }, { status: 401 });
  const { data: rows } = await sb.from('user_roles').select('role').eq('user_id', data.user.id);
  const roles = (rows ?? []).map((r: { role: Role }) => r.role);
  return { sb, actor: { id: data.user.id, roles } };
}

export function errorResponse(e: unknown): NextResponse {
  if (e instanceof InvalidHsCodeError || e instanceof InvalidUploadError) return NextResponse.json({ error: e.message }, { status: 400 });
  if (e instanceof ForbiddenError) return NextResponse.json({ error: e.message }, { status: 403 });
  if (e instanceof StateError) return NextResponse.json({ error: e.message }, { status: 409 });
  console.error(e);
  return NextResponse.json({ error: 'INTERNAL_ERROR' }, { status: 500 });
}
