'use client';
import { useCallback, useEffect, useState } from 'react';
import { AuthGate } from '@/components/SignIn';
import { SectionCard } from '@/components/ResultCards';
import { authedFetch } from '@/lib/supabase/browser';
import type { UnifiedCheckResult } from '@/lib/hs/unified-check';

interface HistoryItem { id: string; hs_code: string; created_at: string; result: UnifiedCheckResult }

function Checker() {
  const [form, setForm] = useState({ hsCode: '', originCountry: '', exportingCountry: '', manufacturer: '', productDescription: '' });
  const [result, setResult] = useState<UnifiedCheckResult | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm({ ...form, [k]: e.target.value });

  const loadHistory = useCallback(async () => {
    const r = await authedFetch('/api/hs-check/history');
    if (r.ok) setHistory((await r.json()).items);
  }, []);
  useEffect(() => { void loadHistory(); }, [loadHistory]);

  async function run() {
    setBusy(true); setError('');
    const r = await authedFetch('/api/hs-check', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(form) });
    const j = await r.json();
    if (r.ok) { setResult(j); void loadHistory(); } else setError(j.error ?? 'เกิดข้อผิดพลาด');
    setBusy(false);
  }

  return (
    <>
      <h1>ตรวจสอบพิกัดและมาตรการ</h1>
      <div style={{ display: 'grid', gap: 8, gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))' }}>
        <input placeholder="HS Code (เช่น 7604.10.10.000)" value={form.hsCode} onChange={set('hsCode')} />
        <input placeholder="ประเทศต้นทาง (เช่น CN / จีน)" value={form.originCountry} onChange={set('originCountry')} />
        <input placeholder="ประเทศผู้ส่งออก" value={form.exportingCountry} onChange={set('exportingCountry')} />
        <input placeholder="ผู้ผลิต/ผู้ส่งออก" value={form.manufacturer} onChange={set('manufacturer')} />
        <input placeholder="รายละเอียดสินค้า" value={form.productDescription} onChange={set('productDescription')} />
      </div>
      <button disabled={busy || !form.hsCode} onClick={run} style={{ marginTop: 8 }}>ตรวจสอบพิกัดและมาตรการ</button>
      {error && <p role="alert" style={{ color: 'crimson' }}>{error}</p>}

      {result && (
        <div style={{ display: 'grid', gap: 12, marginTop: 16 }}>
          <p>พิกัด <strong>{result.hs.display}</strong> · {new Date(result.checkedAt).toLocaleString('th-TH')}</p>
          <SectionCard title="Official Customs" result={result.customs}>
            {result.customs.findings.map((f, i) => <p key={i}>{f.hsCode} — {f.description}</p>)}
          </SectionCard>
          <SectionCard title="AD & Trade Remedies" result={result.ad}>
            {result.ad.findings.map((f) => (
              <details key={f.caseId} open>
                <summary><strong>{f.caseId}</strong> {f.title} — {f.statusRaw}{f.underReview ? ' (อยู่ระหว่างทบทวน)' : ''}</summary>
                <div>ประเทศ: {f.countries.join(', ')} · เทียบประเทศต้นทาง: {f.originRelevance} · ประกาศ {f.announcedText}</div>
                <div>พิกัดที่ตรง: {f.matchedCodes.map((m) => `${m.code} (${m.matchType})`).join(', ')}</div>
                {f.detailUrl && <a href={f.detailUrl} target="_blank" rel="noreferrer">ดูประกาศฉบับเต็ม</a>}
              </details>
            ))}
          </SectionCard>
          <SectionCard title="ACFTA / Form E" result={result.acfta}>
            {result.acfta.findings.map((f) => (
              <div key={f.recordId} style={{ borderTop: '1px solid #e2e8f0', paddingTop: 6 }}>
                <div><strong>{f.hsCode}</strong> {f.description ?? <em>(เอกสารไม่ระบุคำอธิบาย)</em>} · <small>{f.matchType}</small></div>
                <div>อัตราพิเศษ: {f.rate.raw ?? <em>เอกสารไม่ระบุ</em>}{f.rate.value !== null && ` (ค่า ${f.rate.value})`}</div>
                <div>ประเทศที่ได้รับสิทธิ/เงื่อนไข: {f.conditions ?? <em>เอกสารไม่ระบุ</em>} · ช่วงเวลา: {f.effectiveFrom ?? '—'} ถึง {f.effectiveTo ?? '—'}</div>
                <small>ต้นฉบับ: {f.sourceText}</small>
              </div>
            ))}
          </SectionCard>
        </div>
      )}

      <h2>ประวัติการค้นหา</h2>
      <ul>
        {history.map((h) => (
          <li key={h.id}><button onClick={() => setResult(h.result)}>{h.hs_code}</button> {new Date(h.created_at).toLocaleString('th-TH')}</li>
        ))}
      </ul>
    </>
  );
}

export default function Page() { return <AuthGate><Checker /></AuthGate>; }
