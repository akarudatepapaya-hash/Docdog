import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { classifyStatus, extractHsCodes, parseDftMeasureListText } from '@/lib/trade-remedies/dft-parser';

const cases = parseDftMeasureListText(readFileSync(resolve(__dirname, 'fixtures/dft-sample.txt'), 'utf8'));
const byId = (id: string) => cases.find((c) => c.caseId === id)!;

describe('DFT list parser (text rendering)', () => {
  it('parses every case block and stops at pager', () => {
    expect(cases.map((c) => c.caseId)).toEqual(['AD1049', 'SG1008', 'AD1043', 'AD1020', 'AD1018', 'AD1045', 'AD1048']);
  });
  it('splits countries including "และ"', () => {
    expect(byId('AD1018').countries).toEqual(['มาเลเซีย', 'สาธารณรัฐประชาชนจีน']);
    expect(byId('AD1045').countries).toEqual(['สาธารณรัฐประชาชนจีน', 'สาธารณรัฐอินโดนีเซีย', 'มาเลเซีย']);
  });
  it('normalizes mixed HS formats and keeps high confidence when clean', () => {
    expect(byId('AD1049').hsCodes).toContain('76041010000');
    expect(byId('AD1043').hsCodes).toContain('72104917021'); // 7210.4917.021
    expect(byId('AD1049').hsParseConfidence).toBe('HIGH');
  });
  it('does not treat "HS 2017" or Buddhist years as HS codes', () => {
    expect(byId('AD1020').hsCodes).not.toContain('2017');
    expect(byId('AD1045').hsCodes).toEqual(['39202010']);
    expect(byId('AD1045').hsParseConfidence).toBe('LOW'); // free text in HS field
  });
  it('splits glued 22-digit tokens but flags them LOW', () => {
    const r = extractHsCodes('72111419030 7211141903072111419090');
    expect(r.codes).toEqual(expect.arrayContaining(['72111419030', '72111419090']));
    expect(r.confidence).toBe('LOW');
  });
  it('classifies status without inventing meaning', () => {
    expect(classifyStatus('ยุติ').statusClass).toBe('TERMINATED');
    expect(classifyStatus('ใช้มาตรการและอยู่ระหว่างการทบทวน')).toEqual({ statusClass: 'IN_FORCE', underReview: true });
    expect(classifyStatus('อยู่ระหว่างการไต่สวน').statusClass).toBe('UNDER_INVESTIGATION');
    expect(classifyStatus('อื่นๆ').statusClass).toBe('UNKNOWN');
  });
});
