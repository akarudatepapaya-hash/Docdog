'use client';
import { useEffect, useState, type ReactNode } from 'react';
import { supabaseBrowser, supabaseConfigured } from '@/lib/supabase/browser';

const THAI_ERRORS: [RegExp, string][] = [
  [/invalid login credentials/i, 'อีเมลหรือรหัสผ่านไม่ถูกต้อง'],
  [/email not confirmed/i, 'ยังไม่ได้ยืนยันอีเมล กรุณาเปิดอีเมลแล้วกดลิงก์ยืนยัน'],
  [/already registered|already been registered/i, 'อีเมลนี้สมัครไว้แล้ว ลองเข้าสู่ระบบแทน'],
  [/password should be at least/i, 'รหัสผ่านต้องยาวอย่างน้อย 6 ตัวอักษร'],
  [/failed to fetch|networkerror|load failed/i, 'เชื่อมต่อ Supabase ไม่ได้ ตรวจว่าตั้ง Environment Variables บน Vercel ถูกต้องแล้ว Redeploy หรือยัง'],
];
const thai = (m: string) => THAI_ERRORS.find(([re]) => re.test(m))?.[1] ?? m;

export function AuthGate({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [email, setEmail] = useState('');
  const [signedInAs, setSignedInAs] = useState<string | null>(null);
  const [mode, setMode] = useState<'in' | 'up'>('in');
  const [em, setEm] = useState('');
  const [pw, setPw] = useState('');
  const [err, setErr] = useState('');
  const [info, setInfo] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!supabaseConfigured) { setReady(true); return; }
    supabaseBrowser.auth.getSession().then(({ data }) => { setSignedInAs(data.session?.user.email ?? null); setReady(true); });
    const { data: sub } = supabaseBrowser.auth.onAuthStateChange((_e, s) => setSignedInAs(s?.user.email ?? null));
    return () => sub.subscription.unsubscribe();
  }, []);
  void email; void setEmail;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(''); setInfo(''); setBusy(true);
    try {
      if (mode === 'in') {
        const { error } = await supabaseBrowser.auth.signInWithPassword({ email: em.trim(), password: pw });
        if (error) setErr(thai(error.message));
      } else {
        const { data, error } = await supabaseBrowser.auth.signUp({ email: em.trim(), password: pw });
        if (error) setErr(thai(error.message));
        else if (!data.session) setInfo('สมัครสำเร็จ กรุณาเปิดอีเมลเพื่อกดยืนยัน แล้วกลับมาเข้าสู่ระบบ');
      }
    } catch (x) {
      setErr(thai(x instanceof Error ? x.message : 'เกิดข้อผิดพลาด'));
    } finally { setBusy(false); }
  }

  if (!ready) return <p style={{ color: 'var(--mut)' }}>กำลังโหลด…</p>;

  if (!supabaseConfigured) {
    return (
      <div className="auth-wrap"><div className="auth-card">
        <h2>ยังไม่ได้ตั้งค่า Supabase</h2>
        <p role="alert">เว็บนี้ build โดยไม่มีค่า <code>NEXT_PUBLIC_SUPABASE_URL</code> และ <code>NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY</code></p>
        <p className="auth-sub">ไปที่ Vercel → Settings → Environment Variables เพิ่มสองตัวนี้ แล้วกด Redeploy</p>
      </div></div>
    );
  }

  if (signedInAs) {
    return (
      <>
        <div className="userbar">
          <span>{signedInAs}</span>
          <button onClick={() => supabaseBrowser.auth.signOut()}>ออกจากระบบ</button>
        </div>
        {children}
      </>
    );
  }

  return (
    <div className="auth-wrap">
      <form className="auth-card" onSubmit={submit}>
        <div>
          <h2>{mode === 'in' ? 'ยินดีต้อนรับกลับ' : 'สร้างบัญชีใหม่'}</h2>
          <p className="auth-sub">ตรวจพิกัดและมาตรการนำเข้าในหน้าเดียว</p>
        </div>
        <div className="tabs" role="tablist">
          <button type="button" className={mode === 'in' ? 'on' : ''} onClick={() => { setMode('in'); setErr(''); setInfo(''); }}>เข้าสู่ระบบ</button>
          <button type="button" className={mode === 'up' ? 'on' : ''} onClick={() => { setMode('up'); setErr(''); setInfo(''); }}>สมัครสมาชิก</button>
        </div>
        <div className="field"><label htmlFor="em">อีเมล</label>
          <input id="em" type="email" autoComplete="email" required value={em} onChange={(e) => setEm(e.target.value)} placeholder="you@example.com" /></div>
        <div className="field"><label htmlFor="pw">รหัสผ่าน</label>
          <input id="pw" type="password" required minLength={6} autoComplete={mode === 'in' ? 'current-password' : 'new-password'} value={pw} onChange={(e) => setPw(e.target.value)} placeholder="อย่างน้อย 6 ตัวอักษร" /></div>
        {err && <p role="alert" style={{ margin: 0 }}>{err}</p>}
        {info && <p role="status" style={{ margin: 0 }}>{info}</p>}
        <button type="submit" className="btn-primary" disabled={busy}>{busy ? 'กำลังดำเนินการ…' : mode === 'in' ? 'เข้าสู่ระบบ' : 'สมัครสมาชิก'}</button>
        {mode === 'up' && <small>สมาชิกใหม่จะมีสิทธิ์ใช้งานค้นหาเท่านั้น สิทธิ์ Admin ให้ผู้ดูแลตั้งให้</small>}
      </form>
    </div>
  );
}
