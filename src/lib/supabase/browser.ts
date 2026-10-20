'use client';
import { createClient } from '@supabase/supabase-js';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

/** true only when both env vars were present at BUILD time (NEXT_PUBLIC_* are baked in during build). */
export const supabaseConfigured = Boolean(url && key);

export const supabaseBrowser = createClient(url ?? 'https://not-configured.invalid', key ?? 'not-configured');

export async function authedFetch(input: string, init: RequestInit = {}) {
  const { data } = await supabaseBrowser.auth.getSession();
  const headers = new Headers(init.headers);
  if (data.session) headers.set('authorization', `Bearer ${data.session.access_token}`);
  return fetch(input, { ...init, headers });
}
