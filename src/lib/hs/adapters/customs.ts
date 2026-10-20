import type { CheckContext, CustomsResult, NormalizedHs, OfficialCustomsLookup } from '../types';

export const CUSTOMS_PORTAL_URL =
  'http://itd.customs.go.th/igtf/th/main_frame.jsp?lang=th&top_menu=menu_homepage&current_id=5028';

/**
 * No verified machine-readable integration exists yet, so without an injected `lookup` this
 * returns MANUAL_CHECK_REQUIRED + a link. It never fabricates a result.
 */
export function createCustomsAdapter(lookup?: OfficialCustomsLookup, now: () => Date = () => new Date()) {
  return async function customsAdapter(hs: NormalizedHs, _ctx: CheckContext): Promise<CustomsResult> {
    const base = { source: 'OFFICIAL_CUSTOMS' as const, checkedAt: now().toISOString() };
    if (!lookup) {
      return {
        ...base, status: 'MANUAL_CHECK_REQUIRED', findings: [],
        message: 'ยังไม่มีช่องทางดึงข้อมูลศุลกากรที่ตรวจสอบแล้ว กรุณาค้นพิกัดในระบบของกรมศุลกากรด้วยตนเอง',
        provenance: [{ kind: 'MANUAL', sourceName: 'กรมศุลกากร — Integrated Tariff Database', sourceUrl: CUSTOMS_PORTAL_URL }],
        warnings: ['ระบบไม่ได้แสดงอัตราอากรหรือคำอธิบายพิกัดจากศุลกากร ณ ขณะนี้'],
        manualChecksRequired: [`ค้นพิกัด ${hs.display} ที่ ${CUSTOMS_PORTAL_URL}`],
      };
    }
    const r = await lookup.lookup(hs);
    return {
      ...base, status: 'OFFICIAL_RESULT', findings: r.items,
      message: r.items.length ? `พบ ${r.items.length} รายการจากกรมศุลกากร` : 'แหล่งทางการไม่คืนรายการสำหรับพิกัดนี้',
      provenance: [{ kind: 'LIVE_OFFICIAL', sourceName: 'กรมศุลกากร', sourceUrl: r.sourceUrl, retrievedAt: r.retrievedAt }],
      warnings: [], manualChecksRequired: [],
    };
  };
}
