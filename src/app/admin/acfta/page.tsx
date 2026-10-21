'use client';
import { useCallback, useEffect, useState } from 'react';
import { AuthGate } from '@/components/SignIn';
import { authedFetch } from '@/lib/supabase/browser';
import type { AcftaDocument, AcftaRecord } from '@/lib/acfta/types';

const PAGE = 50;
interface Counts { pending: number; approved: number; rejected: number; pendingLow: number }

function Admin() {
  const [docs, setDocs] = useState<AcftaDocument[]>([]);
  const [recs, setRecs] = useState<AcftaRecord[]>([]);
  const [total, setTotal] = useState(0);
  const [counts, setCounts] = useState<Counts | null>(null);
  const [sel, setSel] = useState<AcftaDocument | null>(null);
  const [msg, setMsg] = useState('');
  const [bad, setBad] = useState(false);
  const say = (t: string, isBad = false) => { setMsg(t); setBad(isBad); };
  const [busy, setBusy] = useState(false);
  const [f, setF] = useState({ status: 'PENDING', confidence: '', q: '', page: 0 });

  const loadDocs = useCallback(async () => {
    const r = await authedFetch('/api/acfta/documents');
    if (r.ok) setDocs((await r.json()).items);
  }, []);
  const loadRecs = useCallback(async (d: AcftaDocument, flt = f) => {
    const sp = new URLSearchParams({ limit: String(PAGE), offset: String(flt.page * PAGE) });
    if (flt.status) sp.set('status', flt.status);
    if (flt.confidence) sp.set('confidence', flt.confidence);
    if (flt.q) sp.set('q', flt.q);
    const r = await authedFetch(`/api/acfta/documents/${d.id}/records?${sp}`);
    if (r.ok) { const j = await r.json(); setRecs(j.items); setTotal(j.total); setCounts(j.counts); }
  }, [f]);
  useEffect(() => { void loadDocs(); }, [loadDocs]);
  useEffect(() => { if (sel) void loadRecs(sel, f); }, [sel, f, loadRecs]);

  async function upload(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true); say('กำลังอัปโหลดและอ่านไฟล์ (ไฟล์ใหญ่อาจใช้เวลาครึ่งนาที)…');
    const form = e.currentTarget;
    const r = await authedFetch('/api/acfta/documents', { method: 'POST', body: new FormData(form) });
    const j = await r.json().catch(() => ({ error: `เซิร์ฟเวอร์ตอบ ${r.status} (อาจหมดเวลาหรือไฟล์ใหญ่เกินไป)` }));
    say(r.ok
      ? (j.candidateCount > 0 ? `สกัดได้ ${j.candidateCount} แถว (รอตรวจทาน) ` : `อ่านไฟล์ไม่สำเร็จ: `) + (j.warnings ?? []).join(' · ')
      : j.error, !r.ok || !(j.candidateCount > 0));
    setBusy(false); void loadDocs();
  }
  async function act(id: string, action: 'approve' | 'reject') {
    const r = await authedFetch(`/api/acfta/records/${id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action }) });
    if (!r.ok) say((await r.json()).error, true);
    if (sel) void loadRecs(sel);
  }
  async function bulk(status: 'APPROVED' | 'REJECTED', confidence?: 'MEDIUM') {
    if (!sel) return;
    const label = status === 'APPROVED' ? 'อนุมัติ' : 'ปฏิเสธ';
    if (!confirm(`${label}รายการที่รอตรวจทาน${confidence ? 'ที่ความมั่นใจ "ปานกลาง"' : 'ทั้งหมด'}ของเอกสารนี้?\nควรสุ่มเทียบกับไฟล์ PDF ต้นฉบับก่อน`)) return;
    setBusy(true); say(`กำลัง${label}… (หลายพันแถวอาจใช้เวลาสักครู่)`);
    const r = await authedFetch(`/api/acfta/documents/${sel.id}/review-all`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ status, confidence }) });
    const j = await r.json();
    say(r.ok ? `${label}แล้ว ${j.changed} รายการ` : j.error, !r.ok);
    setBusy(false); void loadRecs(sel);
  }
  async function publish(d: AcftaDocument) {
    const active = docs.find((x) => x.datasetKey === d.datasetKey && x.status === 'PUBLISHED');
    const r = await authedFetch(`/api/acfta/documents/${d.id}/publish`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ supersedes: active?.id }) });
    if (r.ok) say('เผยแพร่แล้ว — ข้อมูลพร้อมใช้ในหน้าตรวจพิกัด'); else say((await r.json()).error, true);
    void loadDocs();
  }
  const setFilter = (p: Partial<typeof f>) => setF({ ...f, page: 0, ...p });

  return (
    <>
      <h1>ACFTA / Form E — นำเข้าและตรวจทาน</h1>
      <form onSubmit={upload} style={{ display: 'grid', gap: 8, maxWidth: 420 }}>
        <input name="name" placeholder="ชื่อเอกสาร (เช่น ประกาศกระทรวงการคลัง ACFTA)" required />
        <input name="version" placeholder="เวอร์ชัน (เช่น 2565-01)" required />
        <input name="file" type="file" accept="application/pdf" required />
        <button disabled={busy}>อัปโหลด (เฉพาะ Admin)</button>
      </form>
      {msg && <p role={bad ? 'alert' : 'status'}>{msg}</p>}
      <h2>เอกสาร</h2>
      <ul>
        {docs.map((d) => (
          <li key={d.id} style={{ margin: '6px 0' }}>
            <button onClick={() => { setSel(d); setF({ status: 'PENDING', confidence: '', q: '', page: 0 }); }}>{d.name} v{d.version}</button> <code>{d.status}</code>
            {d.extractionError && <small style={{ color: 'var(--err)' }}> · สาเหตุ: {d.extractionError}</small>}
            {d.ocrRequiredPages.length > 0 && <small> · ต้อง OCR หน้า {d.ocrRequiredPages.slice(0, 10).join(', ')}</small>}
            {d.status === 'IN_REVIEW' && <> <button onClick={() => publish(d)}>เผยแพร่ (Admin)</button></>}
          </li>
        ))}
      </ul>
      {sel && counts && (
        <>
          <h2>{sel.name} v{sel.version}</h2>
          <p>รอตรวจ <strong>{counts.pending}</strong> (ความมั่นใจต่ำ {counts.pendingLow}) · อนุมัติ {counts.approved} · ปฏิเสธ {counts.rejected}</p>
          {sel.status === 'IN_REVIEW' && (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
              <button disabled={busy} onClick={() => bulk('APPROVED', 'MEDIUM')}>อนุมัติทั้งหมดที่ความมั่นใจปานกลาง</button>
              <button disabled={busy} onClick={() => bulk('APPROVED')}>อนุมัติทั้งหมดที่เหลือ</button>
              <button disabled={busy} onClick={() => bulk('REJECTED')}>ปฏิเสธทั้งหมดที่เหลือ</button>
            </div>
          )}
          <div style={{ display: 'grid', gap: 8, gridTemplateColumns: 'repeat(auto-fit,minmax(160px,1fr))', marginBottom: 10 }}>
            <select value={f.status} onChange={(e) => setFilter({ status: e.target.value })}>
              <option value="PENDING">รอตรวจ</option><option value="APPROVED">อนุมัติแล้ว</option><option value="REJECTED">ปฏิเสธ</option><option value="">ทั้งหมด</option></select>
            <select value={f.confidence} onChange={(e) => setFilter({ confidence: e.target.value })}>
              <option value="">ทุกระดับความมั่นใจ</option><option value="LOW">ต่ำ (ต้องดูเอง)</option><option value="MEDIUM">ปานกลาง</option></select>
            <input placeholder="ค้นพิกัด เช่น 0105" value={f.q} onChange={(e) => setFilter({ q: e.target.value })} />
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table>
              <thead><tr><th>หน้า</th><th>พิกัด</th><th>คำอธิบาย</th><th>อัตรา</th><th>ประเทศที่ได้รับสิทธิ</th><th>มั่นใจ</th><th>สถานะ</th><th /></tr></thead>
              <tbody>
                {recs.map((r) => (
                  <tr key={r.id} title={r.sourceText}>
                    <td>{r.pageNumber}</td><td>{r.hsCodeRaw}</td><td>{r.descriptionRaw ?? '—'}</td><td>{r.rateRaw ?? '—'}</td>
                    <td><small>{r.conditionsRaw ?? '—'}</small></td><td>{r.confidence === 'LOW' ? 'ต่ำ' : 'กลาง'}</td><td>{r.reviewStatus}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>{sel.status === 'IN_REVIEW' && <><button onClick={() => act(r.id, 'approve')}>อนุมัติ</button> <button onClick={() => act(r.id, 'reject')}>ปฏิเสธ</button></>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p>
            แสดง {total === 0 ? 0 : f.page * PAGE + 1}–{Math.min((f.page + 1) * PAGE, total)} จาก {total}{' '}
            <button disabled={f.page === 0} onClick={() => setF({ ...f, page: f.page - 1 })}>ก่อนหน้า</button>{' '}
            <button disabled={(f.page + 1) * PAGE >= total} onClick={() => setF({ ...f, page: f.page + 1 })}>ถัดไป</button>
          </p>
          <small>คำอธิบายภาษาไทยที่อ่านจากไฟล์อาจขาดวรรณยุกต์/สระอำ (เช่น "เนือ" แทน "เนื้อ") ให้ดูหน้าเดียวกันใน PDF ต้นฉบับถ้าต้องการยืนยันถ้อยคำ — พิกัดและอัตราไม่ได้รับผลกระทบ</small>
        </>
      )}
    </>
  );
}

export default function Page() { return <AuthGate><Admin /></AuthGate>; }
