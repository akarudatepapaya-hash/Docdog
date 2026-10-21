import type { SupabaseClient } from '@supabase/supabase-js';
import { matchHs, recordPrefixesOf } from '../hs/normalize';
import type { PublishedAcftaRecord, TradeRemedyCase, TradeRemedyRepository, TradeRemedySnapshot } from '../hs/types';
import { StateError } from './review';
import type {
  AcftaDocument, AcftaRecord, AcftaStore, BlobStore, CandidateRecord, NewDocument, RecordQuery, ReviewEvent,
} from './types';

/* eslint-disable @typescript-eslint/no-explicit-any */
const fail = (e: { message: string } | null, what: string) => {
  if (e) throw new StateError(`${what}: ${e.message}`);
};

const docFromRow = (r: any): AcftaDocument => ({
  id: r.id, datasetKey: r.dataset_key, name: r.name, version: r.version, status: r.status, storagePath: r.storage_path,
  sha256: r.sha256, pageCount: r.page_count, uploadedBy: r.uploaded_by, uploadedAt: r.uploaded_at, supersededBy: r.superseded_by,
  supersedes: r.supersedes, extractionError: r.extraction_error, ocrRequiredPages: r.ocr_required_pages ?? [],
  publishedBy: r.published_by, publishedAt: r.published_at,
});
const candToRow = (c: CandidateRecord) => ({
  page_number: c.pageNumber, hs_code_raw: c.hsCodeRaw, hs_code_digits: c.hsCodeDigits, description_raw: c.descriptionRaw,
  rate_raw: c.rateRaw, rate_value: c.rateValue, conditions_raw: c.conditionsRaw, effective_from: c.effectiveFrom,
  effective_to: c.effectiveTo, source_text: c.sourceText, extraction_method: c.extractionMethod, confidence: c.confidence,
});
const recFromRow = (r: any): AcftaRecord => ({
  id: r.id, documentId: r.document_id, pageNumber: r.page_number, hsCodeRaw: r.hs_code_raw, hsCodeDigits: r.hs_code_digits,
  descriptionRaw: r.description_raw, rateRaw: r.rate_raw, rateValue: r.rate_value == null ? null : Number(r.rate_value),
  conditionsRaw: r.conditions_raw, effectiveFrom: r.effective_from, effectiveTo: r.effective_to, sourceText: r.source_text,
  extractionMethod: r.extraction_method, confidence: r.confidence, reviewStatus: r.review_status,
  editedByReviewer: r.edited_by_reviewer, reviewedBy: r.reviewed_by, reviewedAt: r.reviewed_at, reviewNote: r.review_note,
  candidateSnapshot: r.candidate_snapshot,
});
const FIELD_MAP: Record<string, string> = {
  hsCodeRaw: 'hs_code_raw', hsCodeDigits: 'hs_code_digits', descriptionRaw: 'description_raw', rateRaw: 'rate_raw',
  rateValue: 'rate_value', conditionsRaw: 'conditions_raw', effectiveFrom: 'effective_from', effectiveTo: 'effective_to',
  reviewStatus: 'review_status', reviewNote: 'review_note',
};

/** Acts as the signed-in user; RLS + triggers in the migration are the real enforcement. */
export class SupabaseAcftaStore implements AcftaStore {
  constructor(private sb: SupabaseClient) {}

  async createDocument(d: NewDocument) {
    const { data, error } = await this.sb.from('acfta_documents').insert({
      dataset_key: d.datasetKey, name: d.name, version: d.version, storage_path: d.storagePath, sha256: d.sha256, uploaded_by: d.uploadedBy,
    }).select().single();
    fail(error, 'createDocument'); return docFromRow(data);
  }
  async updateDocument(id: string, patch: Partial<AcftaDocument>) {
    const row: Record<string, unknown> = {};
    if (patch.status) row.status = patch.status;
    if (patch.pageCount !== undefined) row.page_count = patch.pageCount;
    if (patch.extractionError !== undefined) row.extraction_error = patch.extractionError;
    if (patch.ocrRequiredPages) row.ocr_required_pages = patch.ocrRequiredPages;
    const { data, error } = await this.sb.from('acfta_documents').update(row).eq('id', id).select().single();
    fail(error, 'updateDocument'); return docFromRow(data);
  }
  async getDocument(id: string) {
    const { data, error } = await this.sb.from('acfta_documents').select().eq('id', id).maybeSingle();
    fail(error, 'getDocument'); return data ? docFromRow(data) : null;
  }
  async listDocuments() {
    const { data, error } = await this.sb.from('acfta_documents').select().order('uploaded_at', { ascending: false });
    fail(error, 'listDocuments'); return (data ?? []).map(docFromRow);
  }
  async insertCandidates(documentId: string, cands: CandidateRecord[]) {
    const rows = cands.map((c) => ({ ...candToRow(c), document_id: documentId, candidate_snapshot: c }));
    for (let i = 0; i < rows.length; i += 500) {
      const { error } = await this.sb.from('acfta_records').insert(rows.slice(i, i + 500));
      fail(error, 'insertCandidates');
    }
    return rows.length;
  }
  private recQuery(documentId: string, o: RecordQuery, head = false) {
    let q = this.sb.from('acfta_records').select(head ? 'id' : '*', head ? { count: 'exact', head: true } : undefined).eq('document_id', documentId);
    if (o.status) q = q.eq('review_status', o.status);
    if (o.confidence) q = q.eq('confidence', o.confidence);
    const digits = o.q?.replace(/\D/g, '');
    if (digits) q = q.like('hs_code_digits', `${digits}%`);
    return q;
  }
  async listRecords(documentId: string, o: RecordQuery = {}) {
    const PAGE = 1000; // PostgREST returns at most 1000 rows per request
    const out: AcftaRecord[] = [];
    const want = o.limit ?? Infinity;
    for (let off = o.offset ?? 0; out.length < want; off += PAGE) {
      const n = Math.min(PAGE, want - out.length);
      const { data, error } = await this.recQuery(documentId, o).order('page_number').order('hs_code_digits').range(off, off + n - 1);
      fail(error, 'listRecords');
      out.push(...(data ?? []).map(recFromRow));
      if ((data?.length ?? 0) < n) break;
    }
    return out;
  }
  async countRecords(documentId: string, o: RecordQuery = {}) {
    const { count, error } = await this.recQuery(documentId, o, true);
    fail(error, 'countRecords'); return count ?? 0;
  }
  async bulkReview(documentId: string, status: 'APPROVED' | 'REJECTED', filter: { confidence?: 'LOW' | 'MEDIUM' }, _actorId: string) {
    // Preferred: one SQL function call per 2000 rows (migration 20261021000002). Audit rows come from the DB trigger.
    let changed = 0;
    for (let i = 0; i < 40; i++) {
      const { data, error } = await this.sb.rpc('acfta_bulk_review', { _doc: documentId, _status: status, _confidence: filter.confidence ?? null, _limit: 2000 });
      if (error) {
        if (error.code === 'PGRST202' || /could not find the function/i.test(error.message)) return changed + (await this.bulkReviewByIds(documentId, status, filter));
        fail(error, 'bulkReview');
      }
      const n = Number(data ?? 0);
      changed += n;
      if (n === 0) break;
    }
    return changed;
  }

  /** Fallback when the SQL function isn't installed: small id batches (long ?id=in.(...) URLs are rejected as Bad Request). Slow; may stop at a time budget — run again to continue. */
  private async bulkReviewByIds(documentId: string, status: 'APPROVED' | 'REJECTED', filter: { confidence?: 'LOW' | 'MEDIUM' }) {
    const deadline = Date.now() + 45_000;
    let changed = 0;
    while (Date.now() < deadline) {
      let q = this.sb.from('acfta_records').select('id').eq('document_id', documentId).eq('review_status', 'PENDING');
      if (filter.confidence) q = q.eq('confidence', filter.confidence);
      const { data, error } = await q.limit(100);
      fail(error, 'bulkReview.select');
      if (!data?.length) break;
      const { error: e2 } = await this.sb.from('acfta_records').update({ review_status: status }).in('id', data.map((r: any) => r.id));
      fail(e2, 'bulkReview.update');
      changed += data.length;
    }
    return changed;
  }

  async getRecord(id: string) {
    const { data, error } = await this.sb.from('acfta_records').select().eq('id', id).maybeSingle();
    fail(error, 'getRecord'); return data ? recFromRow(data) : null;
  }
  async updateRecord(id: string, patch: Partial<AcftaRecord>, _event: Omit<ReviewEvent, 'id' | 'at'>) {
    // audit rows are written by the DB trigger, so _event is intentionally unused here
    const row: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(patch)) if (FIELD_MAP[k]) row[FIELD_MAP[k]!] = v;
    const { data, error } = await this.sb.from('acfta_records').update(row).eq('id', id).select().single();
    fail(error, 'updateRecord'); return recFromRow(data);
  }
  async publishDocument(documentId: string, supersedesId: string | null) {
    const { error } = await this.sb.rpc('acfta_publish_document', { _doc: documentId, _supersedes: supersedesId });
    fail(error, 'publish');
  }
  async listEvents(documentId: string): Promise<ReviewEvent[]> {
    const { data, error } = await this.sb.from('acfta_review_events').select().eq('document_id', documentId).order('id');
    fail(error, 'listEvents');
    return (data ?? []).map((e: any) => ({ id: String(e.id), documentId: e.document_id, recordId: e.record_id, action: e.action, actorId: e.actor_id, at: e.at, before: e.before, after: e.after, note: e.note }));
  }
  async hasPublishedDataset() {
    const { count, error } = await this.sb.from('acfta_documents').select('id', { count: 'exact', head: true }).eq('status', 'PUBLISHED');
    fail(error, 'hasPublishedDataset'); return (count ?? 0) > 0;
  }
  async findPublished(digits: string): Promise<PublishedAcftaRecord[]> {
    const prefixes = recordPrefixesOf(digits);
    const { data, error } = await this.sb
      .from('acfta_records')
      .select('*, acfta_documents!inner(id,name,version,status)')
      .eq('review_status', 'APPROVED').eq('acfta_documents.status', 'PUBLISHED')
      .or(`hs_code_digits.like.${digits}%${prefixes.length ? `,hs_code_digits.in.(${prefixes.join(',')})` : ''}`)
      .limit(200);
    fail(error, 'findPublished');
    return (data ?? []).filter((r: any) => matchHs(digits, r.hs_code_digits)).map((r: any) => ({
      recordId: r.id, documentId: r.acfta_documents.id, documentName: r.acfta_documents.name, documentVersion: r.acfta_documents.version,
      pageNumber: r.page_number, hsCodeRaw: r.hs_code_raw, hsCodeDigits: r.hs_code_digits, descriptionRaw: r.description_raw,
      rateRaw: r.rate_raw, rateValue: r.rate_value == null ? null : Number(r.rate_value), conditionsRaw: r.conditions_raw,
      effectiveFrom: r.effective_from, effectiveTo: r.effective_to, sourceText: r.source_text, reviewedBy: r.reviewed_by, reviewedAt: r.reviewed_at,
    }));
  }
}

export class SupabaseBlobStore implements BlobStore {
  constructor(private sb: SupabaseClient, private bucket = 'acfta-pdfs') {}
  async put(path: string, bytes: Uint8Array) {
    const { error } = await this.sb.storage.from(this.bucket).upload(path, bytes, { contentType: 'application/pdf', upsert: false });
    if (error) throw new Error(`storage upload failed: ${error.message}`);
  }
}

export class SupabaseTradeRemedyRepository implements TradeRemedyRepository {
  constructor(private sb: SupabaseClient) {}
  async getLatestSnapshot(): Promise<TradeRemedySnapshot | null> {
    const { data: s, error } = await this.sb.from('trade_remedy_snapshots').select().order('retrieved_at', { ascending: false }).limit(1).maybeSingle();
    fail(error, 'snapshot'); if (!s) return null;
    const { data: rows, error: e2 } = await this.sb.from('trade_remedy_cases').select('data').eq('snapshot_id', s.id).limit(5000);
    fail(e2, 'cases');
    return { id: s.id, sourceUrl: s.source_url, retrievedAt: s.retrieved_at, parserVersion: s.parser_version, complete: s.complete, cases: (rows ?? []).map((r: any) => r.data as TradeRemedyCase) };
  }
}
