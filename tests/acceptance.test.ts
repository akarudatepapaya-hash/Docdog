import { describe, expect, it, vi } from 'vitest';
import { ingestAcftaPdf } from '@/lib/acfta/ingest';
import { createReviewService } from '@/lib/acfta/review';
import { runUnifiedCheck } from '@/lib/hs/unified-check';
import { PROVENANCE_LABELS } from '@/lib/hs/labels';
import { ACFTA_NO_DATASET_MESSAGE, ACFTA_NO_MATCH_MESSAGE, type ProvenanceKind } from '@/lib/hs/types';
import { admin, adRepo, dftSnapshot, makePdf, newWorld, realAdapters, reviewer, sampleRows } from './helpers';
import { createAdAdapter } from '@/lib/hs/adapters/ad-remedies';
import { createAcftaAdapter } from '@/lib/hs/adapters/acfta';
import { createCustomsAdapter } from '@/lib/hs/adapters/customs';

async function ingestSample(w = newWorld(), version = 'v1') {
  const bytes = await makePdf([sampleRows]);
  const rep = await ingestAcftaPdf({ actor: admin, bytes, name: 'ACFTA Schedule', version }, w.deps);
  return { w, rep };
}
async function approveAllAndPublish(w: ReturnType<typeof newWorld>, docId: string, supersedes?: string) {
  const svc = createReviewService(w.store);
  for (const r of await w.store.listRecords(docId)) await svc.approve(reviewer, r.id);
  await svc.publish(admin, docId, supersedes);
}

describe('unified check', () => {
  it('one HS code submission triggers all three checks', async () => {
    const customs = vi.fn(createCustomsAdapter());
    const ad = vi.fn(createAdAdapter(adRepo(dftSnapshot())));
    const acfta = vi.fn(createAcftaAdapter(newWorld().store));
    const r = await runUnifiedCheck({ hsCode: '7604.10.10.000', context: { originCountry: 'CN' } }, { customs, ad, acfta });
    expect(customs).toHaveBeenCalledTimes(1);
    expect(ad).toHaveBeenCalledTimes(1);
    expect(acfta).toHaveBeenCalledTimes(1);
    expect(r.ad.status).toBe('MATCH_FOUND');
    expect(r.customs.status).toBe('MANUAL_CHECK_REQUIRED'); // no verified integration -> never a fake result
  });

  it('context is entered once and reused by every adapter', async () => {
    const seen: unknown[] = [];
    const spy = (a: unknown) => async (_h: unknown, ctx: unknown) => { seen.push(ctx); return (a as any); };
    const w = newWorld();
    const real = realAdapters(w.store, dftSnapshot());
    await runUnifiedCheck({ hsCode: '7604.10', context: { originCountry: 'CN', productDescription: 'x' } }, {
      customs: async (h, c) => { seen.push(c); return real.customs(h, c); },
      ad: async (h, c) => { seen.push(c); return real.ad(h, c); },
      acfta: async (h, c) => { seen.push(c); return real.acfta(h, c); },
    });
    expect(seen).toHaveLength(3);
    expect(new Set(seen.map((s) => JSON.stringify(s))).size).toBe(1);
    void spy;
  });

  it('empty ACFTA database returns NO_DATASET with the exact Thai message', async () => {
    const w = newWorld();
    const r = await runUnifiedCheck({ hsCode: '0101.21.00' }, realAdapters(w.store, dftSnapshot()));
    expect(r.acfta.status).toBe('NO_DATASET');
    expect(r.acfta.message).toBe(ACFTA_NO_DATASET_MESSAGE);
    expect(r.acfta.findings).toEqual([]);
  });

  it('uploaded-but-unreviewed PDF (and approved-but-unpublished) is not reference data', async () => {
    const { w, rep } = await ingestSample();
    expect(rep.document.status).toBe('IN_REVIEW');
    expect(rep.candidateCount).toBe(3);
    let r = await runUnifiedCheck({ hsCode: '0101.21.00' }, realAdapters(w.store, null));
    expect(r.acfta.status).toBe('NO_DATASET');

    const svc = createReviewService(w.store);
    for (const rec of await w.store.listRecords(rep.document.id)) await svc.approve(reviewer, rec.id);
    r = await runUnifiedCheck({ hsCode: '0101.21.00' }, realAdapters(w.store, null));
    expect(r.acfta.status).toBe('NO_DATASET'); // approved records still need document publish
  });

  it('an approved + published record is found by HS code with version and page provenance', async () => {
    const { w, rep } = await ingestSample();
    await approveAllAndPublish(w, rep.document.id);
    const r = await runUnifiedCheck({ hsCode: '0101.21.00' }, realAdapters(w.store, null));
    expect(r.acfta.status).toBe('MATCH_FOUND');
    const f = r.acfta.findings[0]!;
    expect(f.hsCode).toBe('0101.21.00');
    expect(f.rate).toEqual({ raw: '5', value: 5 });
    expect(f.document).toMatchObject({ name: 'ACFTA Schedule', version: 'v1', page: 1 });
    expect(r.acfta.provenance[0]).toMatchObject({ kind: 'INTERNAL_DATASET', datasetVersion: 'v1', pageRefs: [1] });
    expect(f.sourceText).toContain('Pure-bred breeding horses');
  });

  it('a more specific 11-digit query matches an 8-digit record, flagged as broader', async () => {
    const { w, rep } = await ingestSample();
    await approveAllAndPublish(w, rep.document.id);
    const r = await runUnifiedCheck({ hsCode: '0101.21.00.000' }, realAdapters(w.store, null));
    expect(r.acfta.findings[0]!.matchType).toBe('RECORD_IS_PREFIX_OF_QUERY');
    expect(r.acfta.warnings.join(' ')).toContain('กว้างกว่า');
  });

  it('unmatched HS code returns NO_MATCH_IN_DATASET (not zero rate, not "no eligibility")', async () => {
    const { w, rep } = await ingestSample();
    await approveAllAndPublish(w, rep.document.id);
    const r = await runUnifiedCheck({ hsCode: '9999.99.99' }, realAdapters(w.store, null));
    expect(r.acfta.status).toBe('NO_MATCH_IN_DATASET');
    expect(r.acfta.message).toBe(ACFTA_NO_MATCH_MESSAGE);
    expect(r.acfta.findings).toEqual([]);
  });

  it('missing tariff values are never silently replaced with zero', async () => {
    const { w, rep } = await ingestSample();
    await approveAllAndPublish(w, rep.document.id);
    const dash = (await runUnifiedCheck({ hsCode: '0101.29.00' }, realAdapters(w.store, null))).acfta.findings[0]!;
    expect(dash.rate.raw).toBe('-');
    expect(dash.rate.value).toBeNull(); // "-" in the document is not 0
    expect(dash.missingFields).toEqual(expect.arrayContaining(['conditions', 'effectivePeriod']));
    const zero = (await runUnifiedCheck({ hsCode: '0102.21.00' }, realAdapters(w.store, null))).acfta.findings[0]!;
    expect(zero.rate.value).toBe(0); // a literal 0 in the document stays 0
    // Any field the document lacks is reported as missing, with a warning
    const r = await runUnifiedCheck({ hsCode: '0101.29.00' }, realAdapters(w.store, null));
    expect(r.acfta.warnings.join(' ')).toContain('ไม่ใช่ค่าศูนย์');
  });
});

describe('source isolation', () => {
  it('AD-source failure does not block ACFTA lookup', async () => {
    const { w, rep } = await ingestSample();
    await approveAllAndPublish(w, rep.document.id);
    const r = await runUnifiedCheck({ hsCode: '0101.21.00' }, {
      customs: createCustomsAdapter(),
      ad: async () => { throw new Error('DFT down'); },
      acfta: createAcftaAdapter(w.store),
    });
    expect(r.ad.status).toBe('SOURCE_ERROR');
    expect(r.ad.warnings.join(' ')).toContain('ไม่ได้แปลว่า');
    expect(r.acfta.status).toBe('MATCH_FOUND');
  });

  it('ACFTA extraction failure does not block AD lookup', async () => {
    const w = newWorld();
    const rep = await ingestAcftaPdf(
      { actor: admin, bytes: await makePdf([sampleRows]), name: 'Bad', version: 'v0' },
      { ...w.deps, extractor: { extract: async () => { throw new Error('boom'); } } },
    );
    expect(rep.document.status).toBe('EXTRACTION_FAILED');
    const r = await runUnifiedCheck({ hsCode: '7604.10.10.000' }, realAdapters(w.store, dftSnapshot()));
    expect(r.acfta.status).toBe('NO_DATASET');
    expect(r.ad.status).toBe('MATCH_FOUND');
  });

  it('ACFTA store outage becomes SOURCE_ERROR while AD still completes; timeouts are isolated too', async () => {
    const broken = { hasPublishedDataset: async () => { throw new Error('db'); }, findPublished: async () => [] };
    const r = await runUnifiedCheck({ hsCode: '7604.10.10.000' }, {
      customs: createCustomsAdapter(), ad: createAdAdapter(adRepo(dftSnapshot())), acfta: createAcftaAdapter(broken),
    });
    expect(r.acfta.status).toBe('SOURCE_ERROR');
    expect(r.ad.status).toBe('MATCH_FOUND');

    const slow = await runUnifiedCheck({ hsCode: '7604.10.10.000' }, {
      customs: () => new Promise(() => {}), ad: createAdAdapter(adRepo(dftSnapshot())), acfta: createAcftaAdapter(newWorld().store), timeoutMs: 30,
    });
    expect(slow.customs.status).toBe('SOURCE_ERROR');
    expect(slow.ad.status).toBe('MATCH_FOUND');
  });

  it('history failure never hides results', async () => {
    const r = await runUnifiedCheck({ hsCode: '7604.10' }, {
      ...realAdapters(newWorld().store, dftSnapshot()), history: { save: async () => { throw new Error('x'); } },
    });
    expect(r.historySaved).toBe(false);
    expect(r.ad.status).toBe('MATCH_FOUND');
  });
});

describe('AD & trade remedies semantics', () => {
  it('no snapshot -> NO_DATASET, never "no AD"', async () => {
    const r = await runUnifiedCheck({ hsCode: '7604.10.10.000' }, realAdapters(newWorld().store, null));
    expect(r.ad.status).toBe('NO_DATASET');
    expect(r.ad.message).toContain('ไม่ได้หมายความว่าไม่มีมาตรการ');
  });
  it('no match -> NO_MATCH_IN_SOURCE with a warning not to conclude exemption', async () => {
    const r = await runUnifiedCheck({ hsCode: '8501.10.00' }, realAdapters(newWorld().store, dftSnapshot()));
    expect(r.ad.status).toBe('NO_MATCH_IN_SOURCE');
    expect(r.ad.message).toContain('ไม่ได้แปลว่าสินค้าไม่ถูกมาตรการ');
  });
  it('unlisted origin is flagged, not treated as exempt; terminated and SG-all-countries handled', async () => {
    const snap = dftSnapshot();
    const a = await createAdAdapter(adRepo(snap))({ input: '', digits: '76041010000', display: '' }, { originCountry: 'Thailand' });
    const f = a.findings.find((x) => x.caseId === 'AD1049')!;
    expect(f.originRelevance).toBe('UNRECOGNIZED_COUNTRY');
    const b = await createAdAdapter(adRepo(snap))({ input: '', digits: '76041010000', display: '' }, { originCountry: 'VN' });
    expect(b.findings.find((x) => x.caseId === 'AD1049')!.originRelevance).toBe('NOT_LISTED');
    expect(b.warnings.join(' ')).toContain('ห้ามสรุปว่ารอดพ้น');
    expect(b.findings.find((x) => x.caseId === 'AD1048')!.statusClass).toBe('TERMINATED');
    const sg = await createAdAdapter(adRepo(snap))({ input: '', digits: '39029090000', display: '' }, { originCountry: 'CN' });
    expect(sg.findings[0]!.originRelevance).toBe('ALL_COUNTRIES');
  });
  it('stale or incomplete cached snapshot is warned about, with retrieval date retained', async () => {
    const old = dftSnapshot(new Date(Date.now() - 30 * 86_400_000).toISOString(), false);
    const r = await createAdAdapter(adRepo(old))({ input: '', digits: '7604', display: '' }, {});
    expect(r.warnings.join(' ')).toMatch(/อายุ 30 วัน/);
    expect(r.warnings.join(' ')).toContain('ไม่ครบทุกหน้า');
    expect(r.provenance[0]).toMatchObject({ kind: 'CACHED_OFFICIAL', retrievedAt: old.retrievedAt });
  });
});

describe('versioning and provenance', () => {
  it('superseding keeps the old version and its review history; publishing without supersede is refused', async () => {
    const a = await ingestSample(undefined, 'v1');
    await approveAllAndPublish(a.w, a.rep.document.id);
    const b = await ingestAcftaPdf({ actor: admin, bytes: await makePdf([sampleRows]), name: 'ACFTA Schedule', version: 'v2' }, a.w.deps);
    const svc = createReviewService(a.w.store);
    for (const r of await a.w.store.listRecords(b.document.id)) await svc.approve(reviewer, r.id);
    await expect(svc.publish(admin, b.document.id)).rejects.toThrow(/supersede/);
    await svc.publish(admin, b.document.id, a.rep.document.id);
    const docs = await a.w.store.listDocuments();
    expect(docs.find((d) => d.id === a.rep.document.id)).toMatchObject({ status: 'SUPERSEDED', supersededBy: b.document.id });
    expect(docs.find((d) => d.id === b.document.id)).toMatchObject({ status: 'PUBLISHED', supersedes: a.rep.document.id });
    expect((await a.w.store.listEvents(a.rep.document.id)).length).toBeGreaterThan(0);
    const r = await runUnifiedCheck({ hsCode: '0101.21.00' }, realAdapters(a.w.store, null));
    expect(r.acfta.findings.every((f) => f.document.version === 'v2')).toBe(true);
    expect(a.w.blobs.files.size).toBe(2); // both original PDFs retained
  });
});

describe('UI contract', () => {
  it('every provenance kind has a distinct label', () => {
    const kinds: ProvenanceKind[] = ['LIVE_OFFICIAL', 'CACHED_OFFICIAL', 'INTERNAL_DATASET', 'AI_SUGGESTION', 'MANUAL'];
    const labels = kinds.map((k) => PROVENANCE_LABELS[k].label);
    expect(new Set(labels).size).toBe(kinds.length);
    expect(PROVENANCE_LABELS.AI_SUGGESTION.label).toContain('ไม่ใช่ข้อมูลทางการ');
  });
});
