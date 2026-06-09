/**
 * Pure helper for the Settings search box (issue #115).
 *
 * Exported so it can be unit-tested in isolation without any React/DOM imports.
 */

/**
 * Returns true when `haystack` contains `query` as a case-insensitive substring.
 * A blank / whitespace-only query always returns true (show everything).
 */
export function matchesSearch(haystack: string, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (q === '') return true;
  return haystack.toLowerCase().includes(q);
}
