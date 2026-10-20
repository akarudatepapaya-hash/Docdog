'use client';
import { PROVENANCE_LABELS } from '@/lib/hs/labels';
import type { Provenance, SourceResult } from '@/lib/hs/types';

const TONE: Record<string, string> = { green: '#166534', blue: '#1d4ed8', purple: '#6d28d9', orange: '#c2410c', gray: '#475569' };

export function ProvenanceBadge({ p }: { p: Provenance }) {
  const l = PROVENANCE_LABELS[p.kind];
  return (
    <div style={{ fontSize: 13, marginTop: 4 }}>
      <span style={{ background: TONE[l.tone], color: '#fff', borderRadius: 4, padding: '1px 6px' }}>{l.label}</span>{' '}
      {p.sourceName}
      {p.sourceUrl && <> · <a href={p.sourceUrl} target="_blank" rel="noreferrer">{p.sourceUrl}</a></>}
      {p.retrievedAt && <> · ดึง/ตรวจเมื่อ {new Date(p.retrievedAt).toLocaleString('th-TH')}</>}
      {p.documentName && <> · เอกสาร {p.documentName} เวอร์ชัน {p.datasetVersion}{p.pageRefs?.length ? ` หน้า ${p.pageRefs.join(', ')}` : ''}</>}
    </div>
  );
}

export function SectionCard({ title, result, children }: { title: string; result: SourceResult<string, unknown>; children?: React.ReactNode }) {
  return (
    <section style={{ border: '1px solid #cbd5e1', borderRadius: 8, padding: 12 }}>
      <h3 style={{ margin: 0 }}>{title} <code style={{ fontSize: 12 }}>{result.status}</code></h3>
      <p>{result.message}</p>
      {children}
      {result.provenance.map((p, i) => <ProvenanceBadge key={i} p={p} />)}
      {result.warnings.length > 0 && <ul style={{ color: '#b45309' }}>{result.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>}
      {result.manualChecksRequired.length > 0 && (
        <div><strong>ต้องตรวจสอบเอง</strong><ul>{result.manualChecksRequired.map((w, i) => <li key={i}>{w}</li>)}</ul></div>
      )}
      <small>ตรวจเมื่อ {new Date(result.checkedAt).toLocaleString('th-TH')}</small>
    </section>
  );
}
