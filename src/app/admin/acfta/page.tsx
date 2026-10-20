'use client';
import { useCallback, useEffect, useState } from 'react';
import { AuthGate } from '@/components/SignIn';
import { authedFetch } from '@/lib/supabase/browser';
import type { AcftaDocument, AcftaRecord } from '@/lib/acfta/types';

function Admin() {
  const [docs, setDocs] = useState<AcftaDocument[]>([]);
  const [recs, setRecs] = useState<AcftaRecord[]>([]);
  const [sel, setSel] = useState<AcftaDocument | null>(null);
  const [msg, setMsg] = useState('');

  const loadDocs = useCallback(async () => {
    const r = await authedFetch('/api/acfta/documents');
    if (r.ok) setDocs((await r.json()).items);
  }, []);
  const loadRecs = useCallback(async (d: AcftaDocument) => {
    setSel(d);
    const r = await authedFetch(`/api/acfta/documents/${d.id}/records`);
    if (r.ok) setRecs((await r.json()).items);
  }, []);
  useEffect(() => { void loadDocs(); }, [loadDocs]);

  async function upload(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const r = await authedFetch('/api/acfta/documents', { method: 'POST', body: new FormData(e.currentTarget) });
    const j = await r.json();
    setMsg(r.ok ? `สกัดได้ ${j.candidateCount} แถว (รอตรวจทาน) ${j.warnings.join(' · ')}` : j.error);
    void loadDocs();
  }
  async function act(id: string, action: 'approve' | 'reject') {
    const r = await authedFetch(`/api/acfta/records/${id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action }) });
    if (!r.ok) setMsg((await r.json()).error);
    if (sel) void loadRecs(sel);
  }
  async function publish(d: AcftaDocument) {
    const active = docs.find((x) => x.datasetKey === d.datasetKey && x.status === 'PUBLISHED');
    const r = await authedFetch(`/api/acfta/documents/${d.id}/publish`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ supersedes: active?.id }),
    });
    setMsg(r.ok ? 'เผยแพร่แล้ว' : (await r.json()).error);
    void loadDocs();
  }

  return (
    <>
      <h1>ACFTA / Form E — นำเข้าและตรวจทาน</h1>
      <form onSubmit={upload} style={{ display: 'grid', gap: 8, maxWidth: 420 }}>
        <input name="name" placeholder="ชื่อเอกสาร" required />
        <input name="version" placeholder="เวอร์ชัน" required />
        <input name="file" type="file" accept="application/pdf" required />
        <button>อัปโหลด (เฉพาะ Admin)</button>
      </form>
      {msg && <p role="status">{msg}</p>}
      <h2>เอกสาร</h2>
      <ul>
        {docs.map((d) => (
          <li key={d.id}>
            <button onClick={() => loadRecs(d)}>{d.name} v{d.version}</button> <code>{d.status}</code>
            {d.ocrRequiredPages.length > 0 && <> · ต้อง OCR หน้า {d.ocrRequiredPages.join(', ')}</>}
            {d.status === 'IN_REVIEW' && <button onClick={() => publish(d)}>เผยแพร่ (Admin)</button>}
          </li>
        ))}
      </ul>
      {sel && (
        <>
          <h2>รายการใน {sel.name} v{sel.version}</h2>
          <table>
            <thead><tr><th>หน้า</th><th>HS</th><th>คำอธิบาย</th><th>อัตรา</th><th>ต้นฉบับ</th><th>สถานะ</th><th /></tr></thead>
            <tbody>
              {recs.map((r) => (
                <tr key={r.id}>
                  <td>{r.pageNumber}</td><td>{r.hsCodeRaw}</td><td>{r.descriptionRaw}</td><td>{r.rateRaw ?? '—'}</td>
                  <td><small>{r.sourceText}</small></td><td>{r.reviewStatus}</td>
                  <td>{sel.status === 'IN_REVIEW' && <><button onClick={() => act(r.id, 'approve')}>อนุมัติ</button> <button onClick={() => act(r.id, 'reject')}>ปฏิเสธ</button></>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </>
  );
}

export default function Page() { return <AuthGate><Admin /></AuthGate>; }
