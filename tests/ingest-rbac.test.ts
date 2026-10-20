import { describe, expect, it } from 'vitest';
import { ForbiddenError, InvalidUploadError, ingestAcftaPdf } from '@/lib/acfta/ingest';
import { createReviewService, StateError } from '@/lib/acfta/review';
import type { OcrProvider } from '@/lib/acfta/ocr';
import { admin, makePdf, member, newWorld, reviewer, sampleRows } from './helpers';

describe('ingestion', () => {
  it('only admins can upload; non-PDF rejected', async () => {
    const w = newWorld();
    const bytes = await makePdf([sampleRows]);
    await expect(ingestAcftaPdf({ actor: reviewer, bytes, name: 'n', version: '1' }, w.deps)).rejects.toThrow(ForbiddenError);
    await expect(ingestAcftaPdf({ actor: member, bytes, name: 'n', version: '1' }, w.deps)).rejects.toThrow(ForbiddenError);
    await expect(ingestAcftaPdf({ actor: admin, bytes: new TextEncoder().encode('hello'), name: 'n', version: '1' }, w.deps)).rejects.toThrow(InvalidUploadError);
  });

  it('keeps original text, page numbers, and flags scanned pages when OCR is not configured', async () => {
    const w = newWorld();
    const bytes = await makePdf([sampleRows, null]);
    const rep = await ingestAcftaPdf({ actor: admin, bytes, name: 'n', version: '1' }, w.deps);
    expect(rep.document.pageCount).toBe(2);
    expect(rep.ocrRequiredPages).toEqual([2]);
    expect(rep.warnings.join(' ')).toContain('ยังไม่ได้ตั้งค่า OCR');
    const recs = await w.store.listRecords(rep.document.id);
    expect(recs.every((r) => r.pageNumber === 1 && r.reviewStatus === 'PENDING')).toBe(true);
    expect(recs[0]!.sourceText).toContain('|');
  });

  it('uses a configured OCR provider only for scanned pages and marks them LOW confidence', async () => {
    const w = newWorld();
    const ocr: OcrProvider = { name: 'fake', recognizePage: async () => ['0201.10.00   Carcasses of bovine animals   30'] };
    const rep = await ingestAcftaPdf({ actor: admin, bytes: await makePdf([sampleRows, null]), name: 'n', version: '1' }, { ...w.deps, ocr });
    const ocrRecs = (await w.store.listRecords(rep.document.id)).filter((r) => r.pageNumber === 2);
    expect(ocrRecs).toHaveLength(1);
    expect(ocrRecs[0]).toMatchObject({ extractionMethod: 'OCR', confidence: 'LOW', rateValue: 30 });
    expect(rep.ocrRequiredPages).toEqual([]);
  });

  it('a PDF with no readable rows becomes EXTRACTION_FAILED, not an empty "dataset"', async () => {
    const w = newWorld();
    const rep = await ingestAcftaPdf({ actor: admin, bytes: await makePdf([null]), name: 'n', version: '1' }, w.deps);
    expect(rep.document.status).toBe('EXTRACTION_FAILED');
    expect(await w.store.hasPublishedDataset()).toBe(false);
  });
});

describe('review workflow and roles', () => {
  async function setup() {
    const w = newWorld();
    const rep = await ingestAcftaPdf({ actor: admin, bytes: await makePdf([sampleRows]), name: 'n', version: '1' }, w.deps);
    return { w, id: rep.document.id, svc: createReviewService(w.store) };
  }
  it('members cannot review; reviewers cannot publish', async () => {
    const { w, id, svc } = await setup();
    const [rec] = await w.store.listRecords(id);
    await expect(svc.approve(member, rec!.id)).rejects.toThrow(ForbiddenError);
    await svc.approve(reviewer, rec!.id);
    await expect(svc.publish(reviewer, id)).rejects.toThrow(ForbiddenError);
  });
  it('publish is blocked while records are pending', async () => {
    const { id, svc } = await setup();
    await expect(svc.publish(admin, id)).rejects.toThrow(StateError);
  });
  it('edit preserves source text and the extractor snapshot, resets to PENDING, and is audited', async () => {
    const { w, id, svc } = await setup();
    const rec = (await w.store.listRecords(id)).find((r) => r.hsCodeRaw === '0101.29.00')!;
    await svc.approve(reviewer, rec.id);
    const edited = await svc.edit(reviewer, rec.id, { rateRaw: '5', rateValue: 5 }, 'fixed column shift');
    expect(edited).toMatchObject({ rateValue: 5, reviewStatus: 'PENDING', editedByReviewer: true });
    expect(edited.sourceText).toBe(rec.sourceText);
    expect(edited.candidateSnapshot.rateValue).toBeNull();
    expect((await w.store.listEvents(id)).map((e) => e.action)).toEqual(['APPROVED', 'EDIT']);
  });
  it('published documents are frozen', async () => {
    const { w, id, svc } = await setup();
    for (const r of await w.store.listRecords(id)) await svc.approve(reviewer, r.id);
    await svc.publish(admin, id);
    const [rec] = await w.store.listRecords(id);
    await expect(svc.edit(reviewer, rec!.id, { rateRaw: '9' })).rejects.toThrow(StateError);
  });
});
