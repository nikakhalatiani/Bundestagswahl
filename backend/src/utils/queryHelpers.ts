/**
 * Reusable SQL query fragments and helpers to reduce redundancy across endpoints.
 */

/**
 * SQL fragment for normalizing German constituency names for matching.
 * Removes umlauts, special chars, and normalizes for comparison.
 */
export const NORMALIZE_NAME_SQL = `replace(replace(replace(lower(regexp_replace(translate(replace(c.name, 'ß', 'ss'), 'ÄÖÜäöü', 'AOUaou'), '[^A-Za-z0-9]+', '', 'g')), 'ae', 'a'), 'oe', 'o'), 'ue', 'u')`;

/**
 * Reusable CTE for ranking candidates by first votes within each constituency.
 * Used by: near-misses, closest-winners, constituency-winners
 */
export const RANKED_CANDIDATES_CTE = (yearParam: string) => `
  RankedCandidates AS (
    SELECT c.id AS constituency_id, c.number AS constituency_number, c.name AS constituency_name,
      s.name AS state_name, dcv.person_id, dcv.party_id, dcv.first_votes,
      ROW_NUMBER() OVER (PARTITION BY dcv.constituency_id ORDER BY dcv.first_votes DESC, dcv.person_id ASC) AS rank
    FROM mv_00_direct_candidacy_votes dcv
    JOIN constituencies c ON c.id = dcv.constituency_id
    JOIN states s ON s.id = c.state_id
    WHERE dcv.year = ${yearParam} AND dcv.first_votes IS NOT NULL AND dcv.first_votes > 0
  ),
  Winners AS (SELECT * FROM RankedCandidates WHERE rank = 1),
  RunnersUp AS (SELECT * FROM RankedCandidates WHERE rank = 2)`;

/**
 * CDU/CSU grouping CASE expression for SELECT clauses.
 */
export const CDU_CSU_CASE = (col: string) =>
  `CASE WHEN ${col} IN ('CDU', 'CSU') THEN 'CDU/CSU' ELSE ${col} END`;

/**
 * Expands CDU/CSU to individual parties for filtering.
 */
export function expandPartyFilter(parties: string[]): string[] {
  return parties.flatMap(p => p.toUpperCase() === 'CDU/CSU' ? ['CDU', 'CSU'] : [p]);
}

/**
 * Safely convert database value to integer.
 */
export function toInt(value: unknown): number {
  if (typeof value === 'number') return Math.trunc(value);
  if (typeof value === 'string') {
    const parsed = parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

/**
 * Parse year from query parameter with default fallback.
 */
export function parseYear(value: unknown, defaultYear = 2025): number {
  if (value === undefined || value === null) return defaultYear;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : defaultYear;
}

/**
 * Parse limit from query parameter with bounds.
 */
export function parseLimit(value: unknown, defaultLimit = 10, maxLimit = 100): number {
  if (value === undefined || value === null) return defaultLimit;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 1) return defaultLimit;
  return Math.min(parsed, maxLimit);
}

/**
 * Party name aliases for normalization.
 */
export const PARTY_ALIASES: Record<string, string[]> = {
  'CDU/CSU': ['CDU', 'CSU'],
  'GRÜNE': ['GRÜNE', 'GRUENE', 'GRUNE'],
  'GRUENE': ['GRÜNE', 'GRUENE', 'GRUNE'],
  'DIE LINKE': ['DIE LINKE', 'LINKE'],
  'LINKE': ['DIE LINKE', 'LINKE'],
};

/**
 * Expand party parameter to handle aliases.
 */
export function expandPartyParam(partyParam: string): string[] {
  const normalized = partyParam.toUpperCase();
  return PARTY_ALIASES[normalized] || partyParam.split(',').map(p => p.trim()).filter(Boolean);
}
