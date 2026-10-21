import { ForbiddenError } from './ingest';
import type { AcftaRecord, AcftaStore, Actor, EditableFields, ReviewStatus } from './types';

const canReview = (a: Actor) => a.roles.includes('reviewer') || a.roles.includes('admin');

export class StateError extends Error { constructor(m: string) { super(m); this.name = 'StateError'; } }

export function createReviewService(store: AcftaStore) {
  async function loadEditable(recordId: string) {
    const rec = await store.getRecord(recordId);
    if (!rec) throw new StateError('ไม่พบรายการ');
    const doc = await store.getDocument(rec.documentId);
    if (!doc || doc.status !== 'IN_REVIEW') throw new StateError('เอกสารไม่ได้อยู่ในสถานะตรวจทาน (แก้ไขรายการที่เผยแพร่แล้วไม่ได้)');
    return rec;
  }

  async function decide(actor: Actor, recordId: string, status: ReviewStatus, note?: string): Promise<AcftaRecord> {
    if (!canReview(actor)) throw new ForbiddenError();
    const rec = await loadEditable(recordId);
    return store.updateRecord(
      recordId,
      { reviewStatus: status, reviewedBy: actor.id, reviewedAt: new Date().toISOString(), reviewNote: note ?? null },
      { documentId: rec.documentId, recordId, action: status, actorId: actor.id, before: { reviewStatus: rec.reviewStatus }, after: { reviewStatus: status }, note: note ?? null },
    );
  }

  return {
    approve: (a: Actor, id: string, note?: string) => decide(a, id, 'APPROVED', note),
    reject: (a: Actor, id: string, note?: string) => decide(a, id, 'REJECTED', note),

    /** Reviewer correction. Source text, page and the extractor's snapshot are never changed. Resets to PENDING. */
    async edit(actor: Actor, recordId: string, fields: EditableFields, note?: string) {
      if (!canReview(actor)) throw new ForbiddenError();
      const rec = await loadEditable(recordId);
      const patch: Partial<AcftaRecord> = { ...fields, editedByReviewer: true, reviewStatus: 'PENDING', reviewedBy: null, reviewedAt: null };
      if (fields.hsCodeRaw && !fields.hsCodeDigits) patch.hsCodeDigits = fields.hsCodeRaw.trim().split(/\s+/)[0]!.replace(/\D/g, '');
      return store.updateRecord(recordId, patch, {
        documentId: rec.documentId, recordId, action: 'EDIT', actorId: actor.id, before: fields && pick(rec, fields), after: fields, note: note ?? null,
      });
    },

    /** Bulk decision for PENDING rows (optionally only one confidence level). Individual audit rows are still written. */
    async decideAll(actor: Actor, documentId: string, status: 'APPROVED' | 'REJECTED', filter: { confidence?: 'LOW' | 'MEDIUM' } = {}) {
      if (!canReview(actor)) throw new ForbiddenError();
      const doc = await store.getDocument(documentId);
      if (!doc || doc.status !== 'IN_REVIEW') throw new StateError('เอกสารไม่ได้อยู่ในสถานะตรวจทาน');
      return store.bulkReview(documentId, status, filter, actor.id);
    },

    async publish(actor: Actor, documentId: string, supersedesId?: string) {
      if (!actor.roles.includes('admin')) throw new ForbiddenError('เฉพาะ Admin เท่านั้นที่เผยแพร่ชุดข้อมูลได้');
      const doc = await store.getDocument(documentId);
      if (!doc || doc.status !== 'IN_REVIEW') throw new StateError('เอกสารต้องอยู่ในสถานะตรวจทานก่อนเผยแพร่');
      const pending = await store.countRecords(documentId, { status: 'PENDING' });
      if (pending > 0) throw new StateError(`ยังมี ${pending} รายการที่รอตรวจทาน`);
      if ((await store.countRecords(documentId, { status: 'APPROVED' })) === 0) throw new StateError('ไม่มีรายการที่อนุมัติ');
      await store.publishDocument(documentId, supersedesId ?? null, actor.id);
    },
  };
}

function pick(rec: AcftaRecord, fields: EditableFields) {
  return Object.fromEntries(Object.keys(fields).map((k) => [k, (rec as unknown as Record<string, unknown>)[k]]));
}
