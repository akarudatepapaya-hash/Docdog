import { createHash } from 'node:crypto';
import { parseRows, linesToRows } from './candidates';
import { endGazette, extractEffectiveFrom, looksLikeGazettePage, newGazetteState, parseGazettePage } from './gazette-parser';
import { notConfiguredOcr, OcrNotConfiguredError, type OcrProvider } from './ocr';
import type { PdfTextExtractor } from './pdf-extract';
import type { AcftaDocument, AcftaStore, Actor, BlobStore, CandidateRecord } from './types';

export class ForbiddenError extends Error { constructor(m = 'ไม่มีสิทธิ์ดำเนินการนี้') { super(m); this.name = 'ForbiddenError'; } }
export class InvalidUploadError extends Error { constructor(m: string) { super(m); this.name = 'InvalidUploadError'; } }

export const MAX_PDF_BYTES = 50 * 1024 * 1024;
export const SCANNED_PAGE_CHAR_THRESHOLD = 30;

export interface IngestDeps {
  store: AcftaStore; blobs: BlobStore; extractor: PdfTextExtractor; ocr?: OcrProvider;
}
export interface IngestInput {
  actor: Actor; bytes: Uint8Array; name: string; version: string; datasetKey?: string;
}
export interface IngestReport {
  document: AcftaDocument; candidateCount: number; ocrRequiredPages: number[]; ignoredRows: number; warnings: string[];
}

export async function ingestAcftaPdf(input: IngestInput, deps: IngestDeps): Promise<IngestReport> {
  if (!input.actor.roles.includes('admin')) throw new ForbiddenError('เฉพาะ Admin เท่านั้นที่อัปโหลดเอกสารได้');
  if (!input.name.trim() || !input.version.trim()) throw new InvalidUploadError('ต้องระบุชื่อเอกสารและเวอร์ชัน');
  if (input.bytes.length === 0 || input.bytes.length > MAX_PDF_BYTES) throw new InvalidUploadError('ขนาดไฟล์ไม่ถูกต้อง (สูงสุด 50MB)');
  if (new TextDecoder().decode(input.bytes.slice(0, 5)) !== '%PDF-') throw new InvalidUploadError('ไฟล์ไม่ใช่ PDF');

  const sha256 = createHash('sha256').update(input.bytes).digest('hex');
  const datasetKey = input.datasetKey ?? 'ACFTA';
  const storagePath = `${datasetKey}/${sha256.slice(0, 16)}-${Date.now()}.pdf`; // never overwrites an earlier upload
  await deps.blobs.put(storagePath, input.bytes);
  let doc = await deps.store.createDocument({
    datasetKey, name: input.name.trim(), version: input.version.trim(), storagePath, sha256, uploadedBy: input.actor.id,
  });

  const warnings: string[] = [];
  const ocrRequiredPages: number[] = [];
  const candidates: CandidateRecord[] = [];
  let ignoredRows = 0;
  let pageCount: number | null = null;
  try {
    const text = await deps.extractor.extract(input.bytes);
    pageCount = text.pageCount;
    const ocr = deps.ocr ?? notConfiguredOcr;
    const gazettePages = text.pages.filter((p) => looksLikeGazettePage(p.rows));
    const isGazette = gazettePages.length >= 10; // the Royal Gazette table layout this project was built against
    const gz = newGazetteState();
    for (const page of text.pages) {
      if (page.charCount >= SCANNED_PAGE_CHAR_THRESHOLD) {
        if (isGazette) {
          if (gazettePages.includes(page)) ignoredRows += parseGazettePage(page.pageNumber, page.rows, gz, candidates).ignoredRows;
          else endGazette(gz, candidates);
          continue;
        }
        const r = parseRows(page.pageNumber, page.rows.map((row) => row.map((c) => c.text)), 'TEXT_LAYER');
        candidates.push(...r.candidates); ignoredRows += r.ignoredRows;
        continue;
      }
      try {
        const lines = await ocr.recognizePage(input.bytes, page.pageNumber);
        const r = parseRows(page.pageNumber, linesToRows(lines), 'OCR');
        candidates.push(...r.candidates); ignoredRows += r.ignoredRows;
      } catch (e) {
        ocrRequiredPages.push(page.pageNumber);
        warnings.push(e instanceof OcrNotConfiguredError
          ? `หน้า ${page.pageNumber} น่าจะเป็นภาพสแกนและยังไม่ได้ตั้งค่า OCR`
          : `OCR หน้า ${page.pageNumber} ล้มเหลว`);
      }
    }
    endGazette(gz, candidates);
    if (isGazette) {
      const from = extractEffectiveFrom(text.pages.slice(0, 5).flatMap((p) => p.rows));
      if (from) for (const c of candidates) c.effectiveFrom = from;
      else warnings.push('ไม่พบวันที่ใช้บังคับในประกาศ จึงไม่ได้ระบุช่วงเวลามีผล');
    }
  } catch (e) {
    const detail = (e instanceof Error ? e.message : String(e)).slice(0, 300);
    doc = await deps.store.updateDocument(doc.id, { status: 'EXTRACTION_FAILED', extractionError: `EXTRACTOR_ERROR: ${detail}` });
    return { document: doc, candidateCount: 0, ocrRequiredPages, ignoredRows, warnings: ['อ่านไฟล์ PDF ไม่สำเร็จ', detail] };
  }

  if (candidates.length === 0) {
    doc = await deps.store.updateDocument(doc.id, {
      status: 'EXTRACTION_FAILED', extractionError: 'NO_CANDIDATES', pageCount, ocrRequiredPages,
    });
    return { document: doc, candidateCount: 0, ocrRequiredPages, ignoredRows, warnings: [...warnings, 'ไม่พบแถวพิกัดที่อ่านได้'] };
  }
  await deps.store.insertCandidates(doc.id, candidates);
  doc = await deps.store.updateDocument(doc.id, { status: 'IN_REVIEW', pageCount, ocrRequiredPages });
  return { document: doc, candidateCount: candidates.length, ocrRequiredPages, ignoredRows, warnings };
}
