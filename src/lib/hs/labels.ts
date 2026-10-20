import type { ProvenanceKind } from './types';

/** Distinct Thai label + tone for every provenance kind; the UI must render these. */
export const PROVENANCE_LABELS: Record<ProvenanceKind, { label: string; tone: 'green' | 'blue' | 'purple' | 'orange' | 'gray' }> = {
  LIVE_OFFICIAL: { label: 'ผลทางการ (ดึงสด)', tone: 'green' },
  CACHED_OFFICIAL: { label: 'ผลทางการ (แคช/สำเนา)', tone: 'blue' },
  INTERNAL_DATASET: { label: 'ชุดข้อมูลภายใน (ผ่านการตรวจทาน)', tone: 'purple' },
  AI_SUGGESTION: { label: 'คำแนะนำจาก AI (ไม่ใช่ข้อมูลทางการ)', tone: 'orange' },
  MANUAL: { label: 'ต้องตรวจสอบด้วยตนเอง', tone: 'gray' },
};

export function provenanceLabel(kind: ProvenanceKind) {
  return PROVENANCE_LABELS[kind];
}
