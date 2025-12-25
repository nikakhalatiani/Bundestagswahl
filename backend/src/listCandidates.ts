import dbModule from './db';
const { pool } = dbModule;

interface CandidateRow {
  person_id: number;
  first_name: string;
  last_name: string;
  artist_name: string | null;
  birth_year: number | null;
  candidacy_type: 'direct' | 'list';
  year: number;
  constituency_id: number | null;
  constituency_number: number | null;
  constituency_name: string | null;
  party_id: number;
  party_short_name: string;
  party_list_id: number | null;
  list_position: number | null;
}

async function listCandidates() {
  const sql = `
-- Direct candidacies
SELECT
  per.id AS person_id,
  per.first_name,
  per.last_name,
  per.artist_name,
  per.birth_year,
  'direct' AS candidacy_type,
  dc.year AS year,
  dc.constituency_id,
  c.number AS constituency_number,
  c.name AS constituency_name,
  dc.party_id,
  p.short_name AS party_short_name,
  NULL::integer AS party_list_id,
  NULL::double precision AS list_position
FROM direct_candidacy dc
JOIN persons per ON per.id = dc.person_id
JOIN parties p ON p.id = dc.party_id
LEFT JOIN constituencies c ON c.id = dc.constituency_id

UNION ALL

-- Party list candidacies
SELECT
  per.id AS person_id,
  per.first_name,
  per.last_name,
  per.artist_name,
  per.birth_year,
  'list' AS candidacy_type,
  pl.year AS year,
  NULL::integer AS constituency_id,
  NULL::integer AS constituency_number,
  NULL::varchar AS constituency_name,
  pl.party_id,
  par.short_name AS party_short_name,
  plc.party_list_id,
  plc.list_position
FROM party_list_candidacy plc
JOIN party_lists pl ON pl.id = plc.party_list_id
JOIN persons per ON per.id = plc.person_id
JOIN parties par ON par.id = pl.party_id

ORDER BY last_name, first_name, year DESC, candidacy_type;
`;

  const res = await pool.query<CandidateRow>(sql);
  return res.rows;
}

if (require.main === module) {
  (async () => {
    try {
      const rows = await listCandidates();
      console.log(JSON.stringify(rows, null, 2));
      process.exit(0);
    } catch (err) {
      console.error('Error listing candidates:', err);
      process.exit(1);
    }
  })();
}

export default listCandidates;
