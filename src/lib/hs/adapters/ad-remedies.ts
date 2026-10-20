import { originRelevance } from '../countries';
import { matchHs } from '../normalize';
import type { AdFinding, AdResult, CheckContext, NormalizedHs, TradeRemedyRepository } from '../types';
import { DFT_LIST_URL } from '../../trade-remedies/dft-parser';

const STALE_DAYS = 7;

export function createAdAdapter(repo: TradeRemedyRepository, now: () => Date = () => new Date()) {
  return async function adAdapter(hs: NormalizedHs, ctx: CheckContext): Promise<AdResult> {
    const checkedAt = now().toISOString();
    const base = { source: 'AD_TRADE_REMEDIES' as const, checkedAt };
    const snap = await repo.getLatestSnapshot();
    if (!snap) {
      return {
        ...base, status: 'NO_DATASET', findings: [], provenance: [],
        message: 'ยังไม่มีข้อมูลมาตรการ AD/Trade Remedies ในระบบ (ยังไม่เคยซิงก์จากกรมการค้าต่างประเทศ) — ไม่ได้หมายความว่าไม่มีมาตรการ',
        warnings: [],
        manualChecksRequired: [`ตรวจสอบด้วยตนเองที่ ${DFT_LIST_URL}`],
      };
    }

    const warnings: string[] = [];
    const findings: AdFinding[] = [];
    for (const c of snap.cases) {
      const matched = c.hsCodes
        .map((code) => ({ code, matchType: matchHs(hs.digits, code) }))
        .filter((m): m is { code: string; matchType: NonNullable<typeof m.matchType> } => m.matchType !== null);
      if (!matched.length) continue;
      findings.push({
        caseId: c.caseId, measureType: c.measureType, title: c.title, countries: c.countries,
        originRelevance: originRelevance(ctx.originCountry, c.countries),
        statusRaw: c.statusRaw, statusClass: c.statusClass, underReview: c.underReview,
        announcedText: c.announcedText, matchedCodes: matched, hsParseConfidence: c.hsParseConfidence,
        detailUrl: c.detailUrl,
      });
    }

    const ageDays = (now().getTime() - new Date(snap.retrievedAt).getTime()) / 86_400_000;
    if (ageDays > STALE_DAYS) warnings.push(`ข้อมูลที่แคชไว้มีอายุ ${Math.floor(ageDays)} วัน (ดึงเมื่อ ${snap.retrievedAt}) ควรซิงก์ใหม่`);
    if (!snap.complete) warnings.push('ข้อมูลที่ซิงก์ไม่ครบทุกหน้า ผลการค้นหาอาจไม่ครบ');

    for (const f of findings) {
      if (f.statusClass === 'TERMINATED') warnings.push(`${f.caseId}: สถานะ "ยุติ" ไม่ใช่มาตรการที่บังคับใช้ ตรวจรายละเอียดประกาศ`);
      if (f.statusClass === 'UNDER_INVESTIGATION') warnings.push(`${f.caseId}: อยู่ระหว่างการไต่สวน ตรวจว่ามีมาตรการชั่วคราวหรือไม่`);
      if (f.originRelevance === 'NOT_LISTED') warnings.push(`${f.caseId}: ประเทศต้นทางที่ระบุไม่อยู่ในรายชื่อ แต่ห้ามสรุปว่ารอดพ้น — ตรวจประเทศผู้ส่งออก ผู้ผลิต และมาตรการ AC (หลบเลี่ยง)`);
      if (f.originRelevance === 'UNRECOGNIZED_COUNTRY') warnings.push(`${f.caseId}: ระบบไม่รู้จักชื่อประเทศที่กรอก จึงไม่ได้เทียบประเทศ`);
      if (f.hsParseConfidence === 'LOW') warnings.push(`${f.caseId}: แปลงรายการพิกัดจากข้อความได้ไม่แน่นอน ต้องอ่านประกาศฉบับเต็ม`);
      if (f.matchedCodes.every((m) => m.matchType === 'QUERY_IS_PREFIX_OF_RECORD'))
        warnings.push(`${f.caseId}: พิกัดที่กรอกกว้างกว่ารายการในประกาศ ตรวจพิกัด 11 หลักของสินค้าจริง`);
    }

    const provenance = [{
      kind: 'CACHED_OFFICIAL' as const,
      sourceName: 'กรมการค้าต่างประเทศ — สินค้าที่ไทยใช้มาตรการ',
      sourceUrl: snap.sourceUrl, retrievedAt: snap.retrievedAt, datasetVersion: `${snap.parserVersion}#${snap.id}`,
    }];
    const manualChecksRequired = [
      'ตรวจขอบเขตสินค้า (product scope) ในประกาศของแต่ละ case',
      'ตรวจประเทศผู้ผลิต/ผู้ส่งออก อัตราเฉพาะราย และมาตรการ AC/SG/CVD ที่เกี่ยวข้อง',
    ];

    if (!findings.length) {
      return {
        ...base, status: 'NO_MATCH_IN_SOURCE', findings, provenance,
        message: 'ไม่พบพิกัดนี้ในรายการที่ซิงก์มา — ไม่ได้แปลว่าสินค้าไม่ถูกมาตรการ (รายการอาจใช้พิกัดคนละระดับ/ข้อความอิสระ)',
        warnings, manualChecksRequired,
      };
    }
    return { ...base, status: 'MATCH_FOUND', findings, provenance, message: `พบ ${findings.length} case ที่พิกัดตรงกัน`, warnings, manualChecksRequired };
  };
}
