import { matchHs } from '../normalize';
import {
  ACFTA_NO_DATASET_MESSAGE, ACFTA_NO_MATCH_MESSAGE,
  type AcftaFinding, type AcftaReader, type AcftaResult, type CheckContext, type NormalizedHs,
} from '../types';

export function createAcftaAdapter(reader: AcftaReader, now: () => Date = () => new Date()) {
  return async function acftaAdapter(hs: NormalizedHs, _ctx: CheckContext): Promise<AcftaResult> {
    const base = { source: 'ACFTA_FORM_E' as const, checkedAt: now().toISOString() };
    if (!(await reader.hasPublishedDataset())) {
      return { ...base, status: 'NO_DATASET', message: ACFTA_NO_DATASET_MESSAGE, findings: [], provenance: [], warnings: [], manualChecksRequired: [] };
    }
    const rows = await reader.findPublished(hs.digits);
    const findings: AcftaFinding[] = [];
    for (const r of rows) {
      const matchType = matchHs(hs.digits, r.hsCodeDigits);
      if (!matchType) continue;
      const missing: string[] = [];
      if (r.descriptionRaw == null) missing.push('description');
      if (r.rateRaw == null && r.rateValue == null) missing.push('preferentialRate');
      if (r.conditionsRaw == null) missing.push('conditions');
      if (r.effectiveFrom == null && r.effectiveTo == null) missing.push('effectivePeriod');
      findings.push({
        recordId: r.recordId, matchType, hsCode: r.hsCodeRaw, description: r.descriptionRaw,
        rate: { raw: r.rateRaw, value: r.rateValue }, conditions: r.conditionsRaw,
        effectiveFrom: r.effectiveFrom, effectiveTo: r.effectiveTo,
        document: { id: r.documentId, name: r.documentName, version: r.documentVersion, page: r.pageNumber },
        sourceText: r.sourceText, missingFields: missing,
      });
    }
    if (!findings.length) {
      return { ...base, status: 'NO_MATCH_IN_DATASET', message: ACFTA_NO_MATCH_MESSAGE, findings, provenance: [], warnings: [], manualChecksRequired: [] };
    }
    const warnings: string[] = [];
    for (const f of findings) {
      if (f.missingFields.length) warnings.push(`หน้า ${f.document.page}: เอกสารไม่มีข้อมูล ${f.missingFields.join(', ')} (ไม่ใช่ค่าศูนย์)`);
      if (f.matchType === 'RECORD_IS_PREFIX_OF_QUERY') warnings.push(`หน้า ${f.document.page}: เอกสารระบุพิกัดระดับ ${f.hsCode} ซึ่งกว้างกว่าพิกัดที่กรอก`);
    }
    const perCode = new Map<string, number>();
    for (const r of rows) perCode.set(`${r.documentId}:${r.hsCodeDigits}`, (perCode.get(`${r.documentId}:${r.hsCodeDigits}`) ?? 0) + 1);
    for (const [k, n] of perCode) if (n > 1) warnings.push(`พิกัด ${k.split(':')[1]} มี ${n} บรรทัดย่อยในเอกสาร (รหัสย่อยต่างกัน อัตราอาจต่างกัน) ตรวจว่าสินค้าตรงบรรทัดใด`);
    const seen = new Set<string>();
    const provenance = findings.flatMap((f) => {
      if (seen.has(f.document.id)) return [];
      seen.add(f.document.id);
      const pages = findings.filter((x) => x.document.id === f.document.id).map((x) => x.document.page);
      return [{
        kind: 'INTERNAL_DATASET' as const, sourceName: 'ACFTA / Form E (เอกสารที่ Admin นำเข้าและผ่านการตรวจทาน)',
        documentId: f.document.id, documentName: f.document.name, datasetVersion: f.document.version,
        pageRefs: [...new Set(pages)].sort((a, b) => a - b),
      }];
    });
    return {
      ...base, status: 'MATCH_FOUND', message: `พบ ${findings.length} รายการในเอกสาร ACFTA`, findings, provenance, warnings,
      manualChecksRequired: ['ตรวจเงื่อนไขแหล่งกำเนิดสินค้า (ROO) และหนังสือรับรอง Form E ก่อนใช้สิทธิ', 'ตรวจว่าเอกสารที่นำเข้ายังเป็นฉบับล่าสุด (อาจมีประกาศแก้ไขภายหลัง) และประเทศที่ได้รับสิทธิตรงกับประเทศต้นทาง'],
    };
  };
}
