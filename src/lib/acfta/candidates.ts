import type { CandidateRecord, ExtractionMethod } from './types';

// HS-like first cell: 6–11 digits with optional dots/spaces/dashes. 4-digit rows are ignored on purpose
// (years, page numbers and chapter headings look identical until a real sample has been reviewed).
const HS_CELL = /^\d{4}(?:[.\s-]?\d{2}){1,2}(?:[.\s-]?\d{3})?$/;
const NUMERIC_RATE = /^(\d+(?:\.\d+)?)\s*%?$/;

export interface RowParseReport { candidates: CandidateRecord[]; ignoredRows: number }

/**
 * Heuristic: first cell = HS code, last cell = rate when numeric, cells between = description.
 * Fields are filled only when unambiguous. A dash/blank rate stays null — never 0.
 * Real column mapping must be confirmed against an actual ACFTA PDF.
 */
export function parseRows(pageNumber: number, rows: string[][], method: ExtractionMethod): RowParseReport {
  const candidates: CandidateRecord[] = [];
  let ignoredRows = 0;
  for (const cells of rows) {
    const first = cells[0]?.trim() ?? '';
    if (!HS_CELL.test(first)) { ignoredRows++; continue; }
    const rest = cells.slice(1);
    const last = rest.length > 1 ? rest[rest.length - 1]!.trim() : '';
    const numeric = NUMERIC_RATE.exec(last);
    const rateCell = rest.length > 1 ? last : '';
    const desc = (rest.length > 1 ? rest.slice(0, -1) : rest).join(' ').trim();
    candidates.push({
      pageNumber, hsCodeRaw: first, hsCodeDigits: first.replace(/\D/g, ''),
      descriptionRaw: desc || null,
      rateRaw: rateCell || null,
      rateValue: numeric ? Number(numeric[1]) : null,
      conditionsRaw: null, effectiveFrom: null, effectiveTo: null,
      sourceText: cells.join(' | '), extractionMethod: method, confidence: method === 'OCR' ? 'LOW' : 'MEDIUM',
    });
  }
  return { candidates, ignoredRows };
}

export function linesToRows(lines: string[]): string[][] {
  return lines.map((l) => l.split(/\t|\s{2,}/).map((c) => c.trim()).filter(Boolean)).filter((r) => r.length);
}
