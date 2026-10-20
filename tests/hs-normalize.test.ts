import { describe, expect, it } from 'vitest';
import { InvalidHsCodeError, matchHs, normalizeHsCode } from '@/lib/hs/normalize';

describe('normalizeHsCode', () => {
  it('accepts dotted / plain / spaced forms', () => {
    expect(normalizeHsCode('7210.49.14.081').digits).toBe('72104914081');
    expect(normalizeHsCode(' 7210 49 14 ').display).toBe('7210.49.14');
    expect(normalizeHsCode('72104914').digits).toBe('72104914');
  });
  it('rejects letters and odd lengths', () => {
    expect(() => normalizeHsCode('72AB')).toThrow(InvalidHsCodeError);
    expect(() => normalizeHsCode('72104')).toThrow(InvalidHsCodeError);
    expect(() => normalizeHsCode('')).toThrow(InvalidHsCodeError);
  });
});

describe('matchHs', () => {
  it('classifies prefix relationships', () => {
    expect(matchHs('72104914', '72104914')).toBe('EXACT');
    expect(matchHs('7210', '72104914')).toBe('QUERY_IS_PREFIX_OF_RECORD');
    expect(matchHs('72104914081', '72104914')).toBe('RECORD_IS_PREFIX_OF_QUERY');
    expect(matchHs('72104914', '72105000')).toBeNull();
  });
});
