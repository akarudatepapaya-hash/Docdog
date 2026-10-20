import type { HsMatchType, NormalizedHs } from './types';

const VALID_LENGTHS = [4, 6, 8, 11];

export class InvalidHsCodeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidHsCodeError';
  }
}

function format(d: string): string {
  const parts = [d.slice(0, 4), d.slice(4, 6), d.slice(6, 8), d.slice(8, 11)].filter(Boolean);
  return parts.join('.');
}

export function normalizeHsCode(raw: string): NormalizedHs {
  const input = (raw ?? '').trim();
  if (!input) throw new InvalidHsCodeError('กรุณากรอก HS Code');
  if (/[^\d.\s\-]/.test(input)) throw new InvalidHsCodeError('HS Code ต้องเป็นตัวเลข (อนุญาตจุด ช่องว่าง หรือขีด)');
  const digits = input.replace(/\D/g, '');
  if (!VALID_LENGTHS.includes(digits.length)) {
    throw new InvalidHsCodeError('HS Code ต้องมี 4, 6, 8 หรือ 11 หลัก');
  }
  return { input, digits, display: format(digits) };
}

/** Prefix-aware comparison of two digit-only codes. */
export function matchHs(queryDigits: string, recordDigits: string): HsMatchType | null {
  if (!queryDigits || !recordDigits) return null;
  if (queryDigits === recordDigits) return 'EXACT';
  if (recordDigits.startsWith(queryDigits)) return 'QUERY_IS_PREFIX_OF_RECORD';
  if (recordDigits.length >= 4 && queryDigits.startsWith(recordDigits)) return 'RECORD_IS_PREFIX_OF_QUERY';
  return null;
}

/** All record-side prefixes (>=4 digits) that could be a broader record for this query. */
export function recordPrefixesOf(queryDigits: string): string[] {
  const out: string[] = [];
  for (let n = 4; n < queryDigits.length; n++) out.push(queryDigits.slice(0, n));
  return out;
}
