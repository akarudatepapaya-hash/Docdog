'use client';
import { useEffect, useState, type ReactNode } from 'react';
import { supabaseBrowser } from '@/lib/supabase/browser';

export function AuthGate({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [signedIn, setSignedIn] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState('');

  useEffect(() => {
    supabaseBrowser.auth.getSession().then(({ data }) => { setSignedIn(!!data.session); setReady(true); });
    const { data: sub } = supabaseBrowser.auth.onAuthStateChange((_e, s) => setSignedIn(!!s));
    return () => sub.subscription.unsubscribe();
  }, []);

  if (!ready) return <p>กำลังโหลด…</p>;
  if (signedIn) return <>{children}</>;
  return (
    <div style={{ display: 'grid', gap: 8, maxWidth: 320 }}>
      <h2>เข้าสู่ระบบ</h2>
      <input placeholder="อีเมล" value={email} onChange={(e) => setEmail(e.target.value)} />
      <input placeholder="รหัสผ่าน" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
      <button onClick={async () => {
        const { error } = await supabaseBrowser.auth.signInWithPassword({ email, password });
        setErr(error ? error.message : '');
      }}>เข้าสู่ระบบ</button>
      {err && <p role="alert" style={{ color: 'crimson' }}>{err}</p>}
    </div>
  );
}
