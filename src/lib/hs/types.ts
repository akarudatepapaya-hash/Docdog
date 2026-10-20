export type ProvenanceKind =
  | 'LIVE_OFFICIAL' // fetched from an official source during this check
  | 'CACHED_OFFICIAL' // copied from an official source earlier; has retrievedAt
  | 'INTERNAL_DATASET' // uploaded by Admin and approved by a reviewer
  | 'AI_SUGGESTION' // never authoritative
  | 'MANUAL'; // user must verify by hand

export type SourceKey = 'OFFICIAL_CUSTOMS' | 'AD_TRADE_REMEDIES' | 'ACFTA_FORM_E';

export interface Provenance {
  kind: ProvenanceKind;
  sourceName: string;
  sourceUrl?: string;
  retrievedAt?: string;
  datasetVersion?: string;
  documentId?: string;
  documentName?: string;
  pageRefs?: number[];
}

export interface SourceResult<S extends string, F> {
  source: SourceKey;
  status: S;
  message: string;
  findings: F[];
  provenance: Provenance[];
  warnings: string[];
  manualChecksRequired: string[];
  checkedAt: string;
}

export interface CheckContext {
  originCountry?: string;
  exportingCountry?: string;
  manufacturer?: string;
  productDescription?: string;
}

export interface NormalizedHs {
  input: string;
  digits: string;
  display: string;
}

export type HsMatchType = 'EXACT' | 'QUERY_IS_PREFIX_OF_RECORD' | 'RECORD_IS_PREFIX_OF_QUERY';

// ---- Customs ----
export type CustomsStatus = 'OFFICIAL_RESULT' | 'MANUAL_CHECK_REQUIRED' | 'UNAVAILABLE' | 'SOURCE_ERROR';
export interface CustomsFinding {
  hsCode: string;
  description: string;
  fields: Record<string, string>;
}
export type CustomsResult = SourceResult<CustomsStatus, CustomsFinding>;

/** Plug-in point for a *verified* official integration. None is shipped. */
export interface OfficialCustomsLookup {
  lookup(hs: NormalizedHs): Promise<{ items: CustomsFinding[]; retrievedAt: string; sourceUrl: string }>;
}

// ---- AD / trade remedies ----
export type AdStatus = 'MATCH_FOUND' | 'NO_MATCH_IN_SOURCE' | 'NO_DATASET' | 'UNAVAILABLE' | 'SOURCE_ERROR';
export type MeasureStatusClass = 'IN_FORCE' | 'UNDER_INVESTIGATION' | 'TERMINATED' | 'UNKNOWN';
export type OriginRelevance =
  | 'LISTED'
  | 'NOT_LISTED'
  | 'ALL_COUNTRIES'
  | 'NOT_PROVIDED'
  | 'UNRECOGNIZED_COUNTRY';

export interface TradeRemedyCase {
  caseId: string;
  measureType: 'AD' | 'AC' | 'SG' | 'CVD';
  title: string;
  countries: string[];
  statusRaw: string;
  statusClass: MeasureStatusClass;
  underReview: boolean;
  announcedText: string;
  hsCodesRaw: string;
  hsCodes: string[]; // digits only
  hsParseConfidence: 'HIGH' | 'LOW';
  hsParseNotes: string[];
  detailUrl?: string;
}

export interface TradeRemedySnapshot {
  id: string;
  sourceUrl: string;
  retrievedAt: string;
  parserVersion: string;
  complete: boolean; // false if not every page was fetched
  cases: TradeRemedyCase[];
}

export interface AdFinding {
  caseId: string;
  measureType: TradeRemedyCase['measureType'];
  title: string;
  countries: string[];
  originRelevance: OriginRelevance;
  statusRaw: string;
  statusClass: MeasureStatusClass;
  underReview: boolean;
  announcedText: string;
  matchedCodes: { code: string; matchType: HsMatchType }[];
  hsParseConfidence: 'HIGH' | 'LOW';
  detailUrl?: string;
}
export type AdResult = SourceResult<AdStatus, AdFinding>;

export interface TradeRemedyRepository {
  getLatestSnapshot(): Promise<TradeRemedySnapshot | null>;
}

// ---- ACFTA ----
export type AcftaStatus = 'MATCH_FOUND' | 'NO_DATASET' | 'NO_MATCH_IN_DATASET' | 'SOURCE_ERROR';

export interface PublishedAcftaRecord {
  recordId: string;
  documentId: string;
  documentName: string;
  documentVersion: string;
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
  reviewedBy: string | null;
  reviewedAt: string | null;
}

export interface AcftaFinding {
  recordId: string;
  matchType: HsMatchType;
  hsCode: string;
  description: string | null;
  rate: { raw: string | null; value: number | null };
  conditions: string | null;
  effectiveFrom: string | null;
  effectiveTo: string | null;
  document: { id: string; name: string; version: string; page: number };
  sourceText: string;
  missingFields: string[];
}
export type AcftaResult = SourceResult<AcftaStatus, AcftaFinding>;

export interface AcftaReader {
  hasPublishedDataset(): Promise<boolean>;
  findPublished(digits: string): Promise<PublishedAcftaRecord[]>;
}

export const ACFTA_NO_DATASET_MESSAGE = 'ยังไม่มีข้อมูล ACFTA ในระบบ กรุณาให้ Admin อัปโหลดเอกสารอ้างอิงก่อน';
export const ACFTA_NO_MATCH_MESSAGE = 'ไม่พบพิกัดนี้ในเอกสาร ACFTA ที่นำเข้าระบบ';
