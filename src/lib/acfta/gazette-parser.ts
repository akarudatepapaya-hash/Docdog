import type { Cell } from './pdf-extract';
import type { CandidateRecord } from './types';

/**
 * Parser for the Thai Royal Gazette table "การยกเว้นอากรและลดอัตราอากรศุลกากร ... เขตการค้าเสรีอาเซียน-จีน"
 * (Ministry of Finance announcement). Columns are identified by the x position of each cell, tuned on the
 * A4 layout of the file supplied for this project:
 *   x<78 heading | 78–125 8-digit code | 125–142 sub-code | 142–335 description | 335–405 rates | >=405 countries
 * One 8-digit code can have several sub-code lines (e.g. 87 / 99) with different rates; each line is its own record.
 */
export const GAZETTE_COLS = { code: 78, sub: 125, desc: 142, rate: 335, countries: 405 } as const;
const CODE = /^\d{4}\.\d{2}\.\d{2}$/;
const SIMPLE_PERCENT = /^\d+(?:\.\d+)?(?:\s+-)*$/; // "5" or "5 - -": plain ad-valorem %, nothing else

export interface GazetteState { code: string | null; current: Draft | null }
interface Draft { pageNumber: number; code: string; sub: string; desc: string[]; rateLines: string[][]; countries: string[]; source: string[] }

export function newGazetteState(): GazetteState { return { code: null, current: null }; }

export function looksLikeGazettePage(rows: Cell[][]): boolean {
  return rows.filter((r) => r.some((c) => c.x >= 70 && c.x < GAZETTE_COLS.sub && CODE.test(c.text))).length >= 3;
}

function flush(state: GazetteState, out: CandidateRecord[]) {
  const d = state.current;
  if (!d) return;
  const desc = d.desc.join(' ').replace(/^(?:-\s*)+/, '').replace(/\s+/g, ' ').trim();
  const lines = d.rateLines.map((l) => l.join(' ')).filter(Boolean);
  const oneSimple = lines.length === 1 && SIMPLE_PERCENT.test(lines[0]!);
  out.push({
    pageNumber: d.pageNumber,
    hsCodeRaw: d.sub ? `${d.code} ${d.sub}` : d.code, // as printed: code + sub-code
    hsCodeDigits: d.code.replace(/\D/g, ''),
    descriptionRaw: desc || null,
    rateRaw: lines.length ? lines.join(' ; ') : null,
    // numeric only for a plain "5" / "5 - -"; words ("ยกเว้นอากร"), unit rates (กก.) or several lines stay text, value null
    rateValue: oneSimple ? Number(lines[0]!.split(/\s+/)[0]) : null,
    conditionsRaw: d.countries.join(' ').replace(/\s+/g, ' ').trim() || null,
    effectiveFrom: null,
    effectiveTo: null,
    sourceText: d.source.join(' / '),
    extractionMethod: 'TEXT_LAYER',
    confidence: lines.length === 1 && (oneSimple || /^(ยกเว้นอากร|ไม่ต้องเสียอากร)$/.test(lines[0]!)) ? 'MEDIUM' : 'LOW',
  });
  state.current = null;
}

/** Feed pages in order; a record's continuation lines may start the next page, so state is carried over. */
export function parseGazettePage(
  pageNumber: number, rows: Cell[][], state: GazetteState, out: CandidateRecord[],
): { ignoredRows: number } {
  let ignored = 0;
  const hdr = rows.findIndex((r) => r.length === 1 && r[0]!.text === 'ร้อยละ');
  const body = hdr >= 0 ? rows.slice(hdr + 1) : rows;
  ignored += rows.length - body.length;
  for (const row of body) {
    const codeCell = row.find((c) => c.x >= 70 && c.x < GAZETTE_COLS.sub && CODE.test(c.text));
    const subCell = row.find((c) => c.x >= GAZETTE_COLS.sub && c.x < GAZETTE_COLS.desc && /^\d{2}(?:\s|$)/.test(c.text));
    if (codeCell) state.code = codeCell.text;
    if (codeCell || subCell) {
      flush(state, out);
      if (!state.code) { ignored++; continue; }
      state.current = { pageNumber, code: state.code, sub: subCell ? subCell.text.slice(0, 2) : '', desc: [], rateLines: [], countries: [], source: [] };
    }
    const d = state.current;
    if (!d) { ignored++; continue; }
    d.source.push(row.map((c) => c.text).join(' | '));
    const rate: string[] = [];
    for (const c of row) {
      if (c === codeCell || c.x < GAZETTE_COLS.sub) continue; // heading / code columns
      if (c.x < GAZETTE_COLS.desc) { const rest = c.text.replace(/^\d{2}\s*/, '').trim(); if (rest) d.desc.push(rest); }
      else if (c.x < GAZETTE_COLS.rate) d.desc.push(c.text);
      else if (c.x < GAZETTE_COLS.countries) rate.push(c.text);
      else d.countries.push(c.text);
    }
    if (rate.length) d.rateLines.push(rate);
  }
  return { ignoredRows: ignored };
}

export function endGazette(state: GazetteState, out: CandidateRecord[]) { flush(state, out); state.code = null; }

const THAI_DIGITS = '๐๑๒๓๔๕๖๗๘๙';
const MONTHS = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];
const toInt = (s: string) => Number([...s].map((ch) => (THAI_DIGITS.includes(ch) ? String(THAI_DIGITS.indexOf(ch)) : ch)).join(''));

/** Finds "ให้ใช้บังคับตั้งแต่วันที่ ๑ มกราคม พ.ศ. ๒๕๖๕" in the announcement text. Returns ISO date or null. */
export function extractEffectiveFrom(rows: Cell[][]): string | null {
  const text = rows.map((r) => r.map((c) => c.text).join(' ')).join(' ');
  const m = /ใช้บังคับตั้งแต่วันที่\s*([๐-๙0-9]+)\s*([ก-๙]+)\s*พ\.ศ\.\s*([๐-๙0-9]+)/.exec(text);
  if (!m) return null;
  const month = MONTHS.indexOf(m[2]!) + 1;
  const day = toInt(m[1]!), year = toInt(m[3]!) - 543;
  if (!month || !day || day > 31 || year < 1900) return null;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}
