import { describe, expect, it } from 'vitest';
import { matchesSearch } from '../src/lib/settingsSearch';

describe('matchesSearch (hand-calculated)', () => {
  it('returns true for an exact match', () => {
    expect(matchesSearch('Date range', 'Date range')).toBe(true);
  });

  it('matches case-insensitively', () => {
    expect(matchesSearch('Carbon estimate — grid factor', 'carbon')).toBe(true);
    expect(matchesSearch('Annual spending target', 'ANNUAL')).toBe(true);
    expect(matchesSearch('Automatic bill checking', 'BILL CHECKING')).toBe(true);
  });

  it('returns false when the query does not match', () => {
    expect(matchesSearch('Date range', 'export')).toBe(false);
    expect(matchesSearch('Currency decimals', 'scheduler')).toBe(false);
  });

  it('empty query always returns true (show all rows)', () => {
    expect(matchesSearch('Anything at all', '')).toBe(true);
    expect(matchesSearch('', '')).toBe(true);
  });

  it('whitespace-only query returns true (treated as empty)', () => {
    expect(matchesSearch('Date range', '   ')).toBe(true);
    expect(matchesSearch('Currency decimals', '\t')).toBe(true);
  });

  it('leading/trailing whitespace in query is trimmed before matching', () => {
    expect(matchesSearch('Date range', '  date  ')).toBe(true);
    expect(matchesSearch('Currency decimals', '  export  ')).toBe(false);
  });

  it('substring match within a longer haystack', () => {
    expect(matchesSearch('Sends one alert on the channel above when a new bill', 'new bill')).toBe(true);
    expect(matchesSearch('Download bill PDFs', 'PDF')).toBe(true);
  });

  it('empty haystack only matches empty/whitespace query', () => {
    expect(matchesSearch('', '')).toBe(true);
    expect(matchesSearch('', '   ')).toBe(true);
    expect(matchesSearch('', 'anything')).toBe(false);
  });
});
