import { matchHs, recordPrefixesOf } from '../hs/normalize';
import type { PublishedAcftaRecord } from '../hs/types';
import { StateError } from './review';
import type {
  AcftaDocument, AcftaRecord, AcftaStore, BlobStore, CandidateRecord, NewDocument, RecordQuery, ReviewEvent,
} from './types';

/** In-memory implementation used by tests; mirrors the rules enforced by the SQL migration. */
export class InMemoryAcftaStore implements AcftaStore {
  docs = new Map<string, AcftaDocument>();
  recs = new Map<string, AcftaRecord>();
  events: ReviewEvent[] = [];
  private n = 0;
  private id(p: string) { return `${p}-${++this.n}`; }

  async createDocument(d: NewDocument) {
    if ([...this.docs.values()].some((x) => x.datasetKey === d.datasetKey && x.name === d.name && x.version === d.version))
      throw new StateError('เอกสารชื่อและเวอร์ชันนี้มีอยู่แล้ว');
    const doc: AcftaDocument = {
      id: this.id('doc'), ...d, status: 'UPLOADED', pageCount: null, uploadedAt: new Date().toISOString(),
      supersededBy: null, supersedes: null, extractionError: null, ocrRequiredPages: [], publishedBy: null, publishedAt: null,
    };
    this.docs.set(doc.id, doc);
    return { ...doc };
  }
  async updateDocument(id: string, patch: Partial<AcftaDocument>) {
    const d = this.docs.get(id); if (!d) throw new StateError('ไม่พบเอกสาร');
    const next = { ...d, ...patch }; this.docs.set(id, next); return { ...next };
  }
  async getDocument(id: string) { const d = this.docs.get(id); return d ? { ...d } : null; }
  async listDocuments() { return [...this.docs.values()].map((d) => ({ ...d })); }
  async insertCandidates(documentId: string, cands: CandidateRecord[]) {
    for (const c of cands) {
      const rec: AcftaRecord = {
        ...c, id: this.id('rec'), documentId, reviewStatus: 'PENDING', editedByReviewer: false,
        reviewedBy: null, reviewedAt: null, reviewNote: null, candidateSnapshot: { ...c },
      };
      this.recs.set(rec.id, rec);
    }
    return cands.length;
  }
  private query(documentId: string, o: RecordQuery = {}) {
    const q = o.q?.replace(/\D/g, '');
    return [...this.recs.values()].filter((r) => r.documentId === documentId
      && (!o.status || r.reviewStatus === o.status) && (!o.confidence || r.confidence === o.confidence)
      && (!q || r.hsCodeDigits.startsWith(q)));
  }
  async listRecords(documentId: string, o: RecordQuery = {}) {
    const all = this.query(documentId, o);
    return all.slice(o.offset ?? 0, o.limit ? (o.offset ?? 0) + o.limit : undefined).map((r) => ({ ...r }));
  }
  async countRecords(documentId: string, o: RecordQuery = {}) { return this.query(documentId, o).length; }
  async bulkReview(documentId: string, status: 'APPROVED' | 'REJECTED', filter: { confidence?: 'LOW' | 'MEDIUM' }, actorId: string) {
    const rows = this.query(documentId, { status: 'PENDING', confidence: filter.confidence });
    for (const r of rows) {
      this.recs.set(r.id, { ...r, reviewStatus: status, reviewedBy: actorId, reviewedAt: new Date().toISOString() });
      this.events.push({ id: this.id('evt'), at: new Date().toISOString(), documentId, recordId: r.id, action: status, actorId, before: { reviewStatus: 'PENDING' }, after: { reviewStatus: status }, note: 'bulk' });
    }
    return rows.length;
  }
  async getRecord(id: string) { const r = this.recs.get(id); return r ? { ...r } : null; }
  async updateRecord(id: string, patch: Partial<AcftaRecord>, event: Omit<ReviewEvent, 'id' | 'at'>) {
    const r = this.recs.get(id); if (!r) throw new StateError('ไม่พบรายการ');
    // immutable provenance columns
    const { sourceText: _s, pageNumber: _p, documentId: _d, candidateSnapshot: _c, ...allowed } = patch;
    const next = { ...r, ...allowed }; this.recs.set(id, next);
    this.events.push({ ...event, id: this.id('evt'), at: new Date().toISOString() });
    return { ...next };
  }
  async publishDocument(documentId: string, supersedesId: string | null, actorId: string) {
    const doc = this.docs.get(documentId)!;
    const active = [...this.docs.values()].find((d) => d.datasetKey === doc.datasetKey && d.status === 'PUBLISHED');
    if (active && active.id !== supersedesId) throw new StateError('มีชุดข้อมูลที่เผยแพร่อยู่แล้ว ต้องระบุเอกสารที่จะแทนที่ (supersede)');
    if (supersedesId) {
      const old = this.docs.get(supersedesId);
      if (!old || old.status !== 'PUBLISHED') throw new StateError('เอกสารที่จะแทนที่ต้องเป็นฉบับที่เผยแพร่อยู่');
      this.docs.set(old.id, { ...old, status: 'SUPERSEDED', supersededBy: documentId });
    }
    this.docs.set(documentId, { ...doc, status: 'PUBLISHED', supersedes: supersedesId, publishedBy: actorId, publishedAt: new Date().toISOString() });
    this.events.push({ id: this.id('evt'), at: new Date().toISOString(), documentId, recordId: null, action: 'PUBLISH', actorId, before: null, after: { supersedes: supersedesId }, note: null });
  }
  async listEvents(documentId: string) { return this.events.filter((e) => e.documentId === documentId); }
  async hasPublishedDataset() { return [...this.docs.values()].some((d) => d.status === 'PUBLISHED'); }
  async findPublished(digits: string): Promise<PublishedAcftaRecord[]> {
    const pubIds = new Set([...this.docs.values()].filter((d) => d.status === 'PUBLISHED').map((d) => d.id));
    const prefixes = new Set(recordPrefixesOf(digits));
    return [...this.recs.values()]
      .filter((r) => pubIds.has(r.documentId) && r.reviewStatus === 'APPROVED')
      .filter((r) => matchHs(digits, r.hsCodeDigits) !== null || prefixes.has(r.hsCodeDigits))
      .map((r) => {
        const d = this.docs.get(r.documentId)!;
        return {
          recordId: r.id, documentId: d.id, documentName: d.name, documentVersion: d.version, pageNumber: r.pageNumber,
          hsCodeRaw: r.hsCodeRaw, hsCodeDigits: r.hsCodeDigits, descriptionRaw: r.descriptionRaw, rateRaw: r.rateRaw,
          rateValue: r.rateValue, conditionsRaw: r.conditionsRaw, effectiveFrom: r.effectiveFrom, effectiveTo: r.effectiveTo,
          sourceText: r.sourceText, reviewedBy: r.reviewedBy, reviewedAt: r.reviewedAt,
        };
      });
  }
}

export class InMemoryBlobStore implements BlobStore {
  files = new Map<string, Uint8Array>();
  async put(path: string, bytes: Uint8Array) {
    if (this.files.has(path)) throw new Error('refusing to overwrite stored PDF');
    this.files.set(path, bytes);
  }
}
