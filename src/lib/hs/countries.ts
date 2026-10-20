import type { OriginRelevance } from './types';

// Small alias table. Anything not recognized is reported as UNRECOGNIZED_COUNTRY, never guessed.
const ALIASES: Record<string, string> = {
  cn: 'สาธารณรัฐประชาชนจีน', china: 'สาธารณรัฐประชาชนจีน', 'จีน': 'สาธารณรัฐประชาชนจีน',
  vn: 'สาธารณรัฐสังคมนิยมเวียดนาม', vietnam: 'สาธารณรัฐสังคมนิยมเวียดนาม', 'เวียดนาม': 'สาธารณรัฐสังคมนิยมเวียดนาม',
  kr: 'สาธารณรัฐเกาหลี', korea: 'สาธารณรัฐเกาหลี', 'เกาหลี': 'สาธารณรัฐเกาหลี', 'เกาหลีใต้': 'สาธารณรัฐเกาหลี',
  tw: 'ไต้หวัน', taiwan: 'ไต้หวัน', 'ไต้หวัน': 'ไต้หวัน',
  jp: 'ญี่ปุ่น', japan: 'ญี่ปุ่น', 'ญี่ปุ่น': 'ญี่ปุ่น',
  id: 'สาธารณรัฐอินโดนีเซีย', indonesia: 'สาธารณรัฐอินโดนีเซีย', 'อินโดนีเซีย': 'สาธารณรัฐอินโดนีเซีย',
  my: 'มาเลเซีย', malaysia: 'มาเลเซีย', 'มาเลเซีย': 'มาเลเซีย',
  in: 'สาธารณรัฐอินเดีย', india: 'สาธารณรัฐอินเดีย', 'อินเดีย': 'สาธารณรัฐอินเดีย',
  eu: 'สหภาพยุโรป', 'สหภาพยุโรป': 'สหภาพยุโรป',
  us: 'สหรัฐอเมริกา', usa: 'สหรัฐอเมริกา', 'สหรัฐอเมริกา': 'สหรัฐอเมริกา',
};

export function canonicalCountry(input: string | undefined): string | null {
  if (!input) return null;
  const k = input.trim().toLowerCase();
  if (ALIASES[k]) return ALIASES[k]!;
  // exact match against full official Thai names is handled by caller (countries list)
  return null;
}

export function originRelevance(origin: string | undefined, listed: string[]): OriginRelevance {
  if (listed.some((c) => c.includes('ไม่ระบุประเทศ'))) return 'ALL_COUNTRIES';
  if (!origin || !origin.trim()) return 'NOT_PROVIDED';
  const canon = canonicalCountry(origin) ?? listed.find((c) => c === origin.trim()) ?? null;
  if (!canon) return 'UNRECOGNIZED_COUNTRY';
  return listed.includes(canon) ? 'LISTED' : 'NOT_LISTED';
}
