import type { PublishedAcftaRecord } from '../hs/types';

export type Role = 'admin' | 'reviewer' | 'member';
export interface Actor { id: string; roles: Role[] }

export type DocumentStatus =
  | 'UPLOADED' | 'IN_REVIEW' | 'EXTRACTION_FAILED' | 'PUBLISHED' | 'SUPERSEDED' | 'REJECTED';
export type ReviewStatus = 'PENDING' | 'APPROVED' | 'REJECTED';
export type ExtractionMethod = 'TEXT_LAYER' | 'OCR';

export interface AcftaDocument {
  id: string;
  datasetKey: string;
  name: string;
  version: string;
  status: DocumentStatus;
  storagePath: string;
  sha256: string;
  pageCount: number | null;
  uploadedBy: string;
  uploadedAt: string;
  supersededBy: string | null;
  supersedes: string | null;
  extractionError: string | null;
  ocrRequiredPages: number[];
  publishedBy: string | null;
  publishedAt: string | null;
}

export interface CandidateRecord {
  pageNumber: number;
  hsCodeRaw: string;
  hsCodeDigits: string;
  descriptionRaw: string | null;
  rateRaw: string | null;
  rateValue: number | null;
  conditionsRaw: string | null;
  effectiveFrom: string | null;
  effectiveTo: string | null;
  sourceText: string;
  extractionMethod: ExtractionMethod;
  confidence: 'LOW' | 'MEDIUM';
}

export interface AcftaRecord extends CandidateRecord {
  id: string;
  documentId: string;
  reviewStatus: ReviewStatus;
  editedByReviewer: boolean;
  reviewedBy: string | null;
  reviewedAt: string | null;
  reviewNote: string | null;
  candidateSnapshot: CandidateRecord; // immutable copy of what the extractor produced
}

export type EditableFields = Partial<Pick<CandidateRecord,
  'hsCodeRaw' | 'hsCodeDigits' | 'descriptionRaw' | 'rateRaw' | 'rateValue' | 'conditionsRaw' | 'effectiveFrom' | 'effectiveTo'>>;

export interface ReviewEvent {
  id: string; documentId: string; recordId: string | null; action: string;
  actorId: string; at: string; before: unknown; after: unknown; note: string | null;
}

export interface NewDocument {
  datasetKey: string; name: string; version: string; storagePath: string; sha256: string; uploadedBy: string;
}

export interface AcftaStore {
  createDocument(d: NewDocument): Promise<AcftaDocument>;
  updateDocument(id: string, patch: Partial<AcftaDocument>): Promise<AcftaDocument>;
  getDocument(id: string): Promise<AcftaDocument | null>;
  listDocuments(): Promise<AcftaDocument[]>;
  insertCandidates(documentId: string, cands: CandidateRecord[]): Promise<number>;
  listRecords(documentId: string, status?: ReviewStatus): Promise<AcftaRecord[]>;
  getRecord(id: string): Promise<AcftaRecord | null>;
  updateRecord(id: string, patch: Partial<AcftaRecord>, event: Omit<ReviewEvent, 'id' | 'at'>): Promise<AcftaRecord>;
  publishDocument(documentId: string, supersedesId: string | null, actorId: string): Promise<void>;
  listEvents(documentId: string): Promise<ReviewEvent[]>;
  hasPublishedDataset(): Promise<boolean>;
  findPublished(digits: string): Promise<PublishedAcftaRecord[]>;
}

export interface BlobStore {
  put(path: string, bytes: Uint8Array): Promise<void>;
}
