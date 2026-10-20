'use client';
import { createClient } from '@supabase/supabase-js';

export const supabaseBrowser = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://localhost:54321',
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? 'missing',
);

export async function authedFetch(input: string, init: RequestInit = {}) {
  const { data } = await supabaseBrowser.auth.getSession();
  const headers = new Headers(init.headers);
  if (data.session) headers.set('authorization', `Bearer ${data.session.access_token}`);
  return fetch(input, { ...init, headers });
}
