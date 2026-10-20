import type { MeasureStatusClass, TradeRemedyCase } from '../hs/types';

export const DFT_PARSER_VERSION = 'dft-text-v1';
export const DFT_LIST_URL = 'https://thaitr.dft.go.th/th/measure_use?orderBy=date_desc';

const CASE_RE = /^(AD|AC|SG|CVD|CV)(\d{4})\s+(.*)$/;
const STD_LENGTHS = [4, 6, 8, 11];

export function classifyStatus(raw: string): { statusClass: MeasureStatusClass; underReview: boolean } {
  const underReview = raw.includes('ทบทวน');
  if (raw.includes('ยุติ')) return { statusClass: 'TERMINATED', underReview };
  if (raw.includes('ไต่สวน')) return { statusClass: 'UNDER_INVESTIGATION', underReview };
  if (raw.includes('ใช้มาตรการ')) return { statusClass: 'IN_FORCE', underReview };
  return { statusClass: 'UNKNOWN', underReview };
}

export function extractHsCodes(raw: string): { codes: string[]; confidence: 'HIGH' | 'LOW'; notes: string[] } {
  const notes: string[] = [];
  const cleaned = raw
    .replace(/HS\s*\d{4}\s*:/gi, ' ') // "HS 2017 :" label, not a code
    .replace(/(?:ปี|พ\.ศ\.)\s*\d{4}/g, ' '); // Buddhist-era years in prose
  const hasFreeText = /[\u0E00-\u0E7F]/.test(cleaned.replace(/และ/g, ''));
  const codes = new Set<string>();
  for (const tok of cleaned.split(/[\s,;()]+/)) {
    if (!/\d/.test(tok)) continue;
    if (/[^\d.]/.test(tok)) continue; // contains letters (e.g. Thai words glued to numbers)
    const d = tok.replace(/\D/g, '');
    if (d.length < 4) continue;
    if (STD_LENGTHS.includes(d.length)) codes.add(d);
    else if (d.length > 11 && d.length % 11 === 0) {
      for (let i = 0; i < d.length; i += 11) codes.add(d.slice(i, i + 11));
      notes.push(`แยกพิกัดที่ติดกัน ${d.length} หลัก เป็นชุดละ 11 หลัก`);
    } else notes.push(`ข้ามโทเคนที่ไม่ใช่รูปแบบพิกัดมาตรฐาน: ${tok}`);
  }
  if (hasFreeText) notes.push('ช่องพิกัดมีข้อความอิสระ ต้องอ่านประกาศฉบับเต็ม');
  return { codes: [...codes], confidence: notes.length ? 'LOW' : 'HIGH', notes };
}

function splitCountries(text: string): string[] {
  return text
    .replace(/ดูเพิ่มเติม/g, '')
    .split(/,\s*|\s+และ\s+/)
    .map((s) => s.replace(/^และ\s+/, '').trim())
    .filter(Boolean);
}

/**
 * Parses the *text rendering* of https://thaitr.dft.go.th/th/measure_use.
 * NOTE: verified against a text/markdown rendering of the page only. Raw-HTML structure has
 * not been verified, so the sync job refuses to replace a snapshot when parsing looks wrong.
 */
export function parseDftMeasureListText(text: string): TradeRemedyCase[] {
  const lines = text.split(/\r?\n/);
  const starts: number[] = [];
  lines.forEach((l, i) => {
    if (CASE_RE.test(l.trim())) starts.push(i);
  });
  const cases: TradeRemedyCase[] = [];
  starts.forEach((s, idx) => {
    let end = starts[idx + 1] ?? lines.length;
    for (let i = s + 1; i < end; i++) {
      if (/^\[ก่อนหน้า\]/.test(lines[i]!.trim())) { end = i; break; }
    }
    const block = lines.slice(s, end);
    const m = CASE_RE.exec(block[0]!.trim())!;
    const caseId = `${m[1]}${m[2]}`;
    const measureType = (m[1] === 'CV' ? 'CVD' : m[1]) as TradeRemedyCase['measureType'];

    const iOrigin = block.findIndex((l) => l.includes('ที่มีแหล่งกำเนิดจาก'));
    const title = [m[3]!.trim(), ...block.slice(1, iOrigin > 0 ? iOrigin : 1).map((l) => l.trim())]
      .filter(Boolean).join(' ');
    let countries: string[] = [];
    if (iOrigin >= 0) {
      const parts: string[] = [block[iOrigin]!.replace(/^.*ที่มีแหล่งกำเนิดจาก\s*:?/, '').trim()];
      for (let i = iOrigin + 1; i < block.length && !/^\s*สถานะ\s*:/.test(block[i]!); i++) parts.push(block[i]!.trim());
      countries = splitCountries(parts.join(' ').trim());
    }
    const statusRaw = (block.find((l) => /^\s*สถานะ\s*:/.test(l)) ?? '').replace(/^\s*สถานะ\s*:/, '').trim();
    const announcedText = (block.find((l) => /^\s*วันที่\s*:/.test(l)) ?? '').replace(/^\s*วันที่\s*:/, '').trim();

    const iHs = block.findIndex((l) => /^\s*พิกัดศุลกากร\s*:/.test(l));
    let iDetail = block.findIndex((l) => l.trim().startsWith('[รายละเอียด]'));
    if (iDetail < 0) iDetail = block.length;
    const hsRaw = iHs >= 0
      ? [block[iHs]!.replace(/^\s*พิกัดศุลกากร\s*:/, ''), ...block.slice(iHs + 1, iDetail)].join(' ').trim()
      : '';
    const detailUrl = /\((https?:\/\/[^)]+)\)/.exec(block[iDetail] ?? '')?.[1];
    const parsed = extractHsCodes(hsRaw);
    const { statusClass, underReview } = classifyStatus(statusRaw);
    cases.push({
      caseId, measureType, title, countries, statusRaw, statusClass, underReview, announcedText,
      hsCodesRaw: hsRaw, hsCodes: parsed.codes,
      hsParseConfidence: hsRaw ? parsed.confidence : 'LOW',
      hsParseNotes: hsRaw ? parsed.notes : ['ไม่พบช่องพิกัดศุลกากร'],
      detailUrl,
    });
  });
  return cases;
}

export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, '')
    .replace(/<a\s[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, (_m, href, inner) => `[${String(inner).replace(/<[^>]+>/g, '').trim()}](${href})`)
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|tr|h\d|section|article|span)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n');
}

export interface SyncOptions {
  fetchImpl?: typeof fetch;
  maxPages?: number;
  delayMs?: number;
  minCases?: number;
}

/** Fetches every page of the list. Throws (so caller keeps the old snapshot) if results look wrong. */
export async function fetchDftCases(opts: SyncOptions = {}) {
  const f = opts.fetchImpl ?? fetch;
  const maxPages = opts.maxPages ?? 20;
  const all = new Map<string, TradeRemedyCase>();
  let pages = 0;
  let complete = false;
  for (let p = 1; p <= maxPages; p++) {
    const url = p === 1 ? DFT_LIST_URL : `https://thaitr.dft.go.th/th/measure_use?page=${p}`;
    const res = await f(url, { headers: { 'user-agent': 'Docdog-trade-compliance/0.1 (contact: admin)' } });
    if (!res.ok) throw new Error(`DFT responded ${res.status} for page ${p}`);
    const found = parseDftMeasureListText(htmlToText(await res.text()));
    pages++;
    const before = all.size;
    for (const c of found) all.set(c.caseId, c);
    if (found.length === 0 || all.size === before) { complete = true; break; }
    if (opts.delayMs) await new Promise((r) => setTimeout(r, opts.delayMs));
  }
  const minCases = opts.minCases ?? 10;
  if (all.size < minCases) throw new Error(`Parsed only ${all.size} cases (<${minCases}); refusing to replace snapshot`);
  return { cases: [...all.values()], pages, complete, retrievedAt: new Date().toISOString() };
}
