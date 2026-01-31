/**
 * Constituency-related routes - overview, winners, details.
 */
import { Router } from 'express';
import dbModule from '../db';
import { ensureCacheMiddleware } from '../services/cacheSeats';
const { pool } = dbModule;

const router = Router();

/**
 * GET /api/constituencies - List all constituencies for selection/autocomplete.
 */
router.get('/constituencies', async (req, res) => {
  const year = req.query.year ? Number(req.query.year) : 2025;

  try {
    const result = await pool.query(
      `SELECT
         c.id,
         c.number,
         c.name,
         s.name AS state_name
       FROM constituency_elections ce
       JOIN constituencies c ON c.id = ce.constituency_id
       JOIN states s ON s.id = c.state_id
       WHERE ce.year = $1
       ORDER BY c.number ASC`,
      [year]
    );

    res.json({ data: result.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'db_error' });
  }
});

/**
 * GET /api/constituency/:id - Get basic constituency info.
 */
router.get('/constituency/:id', async (req, res) => {
  const constituencyId = Number(req.params.id);

  try {
    const result = await pool.query(
      `SELECT id, number, name FROM constituencies WHERE id = $1`,
      [constituencyId]
    );

    if (!result.rows || result.rows.length === 0) {
      return res.status(404).json({ error: 'not_found' });
    }

    res.json({ data: result.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'db_error' });
  }
});

/**
 * GET /api/constituency/:id/overview - Detailed constituency overview (Q3).
 * Requires cache for seat information.
 */
router.get('/constituency/:id/overview', ensureCacheMiddleware, async (req, res) => {
  const constituencyId = Number(req.params.id);
  const year = req.query.year ? Number(req.query.year) : 2025;

  try {
    // 1. Basic constituency info
    const constRes = await pool.query(
      `SELECT c.id, c.number, c.name, s.name AS state
       FROM constituencies c
       JOIN states s ON s.id = c.state_id
       WHERE c.id = $1`,
      [constituencyId]
    );
    if (!constRes.rows.length) {
      return res.status(404).json({ error: 'constituency_not_found' });
    }

    // 2. Election statistics
    const statsRes = await pool.query(
      `SELECT
         ce.eligible_voters,
         (COALESCE(mce.valid_first, 0) + COALESCE(mce.invalid_first, 0)) AS total_voters,
         CASE
           WHEN ce.eligible_voters IS NULL OR ce.eligible_voters = 0 THEN NULL
           ELSE ((COALESCE(mce.valid_first, 0) + COALESCE(mce.invalid_first, 0)) * 100.0 / ce.eligible_voters)
         END AS turnout_percent,
         COALESCE(mce.invalid_first, 0) AS invalid_first,
         COALESCE(mce.invalid_second, 0) AS invalid_second,
         COALESCE(mce.valid_first, 0) AS valid_first,
         COALESCE(mce.valid_second, 0) AS valid_second
       FROM constituency_elections ce
       LEFT JOIN mv_03_constituency_elections mce
         ON mce.constituency_id = ce.constituency_id
        AND mce.year = ce.year
       WHERE ce.constituency_id = $1 AND ce.year = $2`,
      [constituencyId, year]
    );

    // 3. Winner info with seat status from cache
    const winnerRes = await pool.query(
      `SELECT dcv.person_id,
              p.first_name || ' ' || p.last_name AS full_name,
              pt.short_name AS party_name,
              dcv.first_votes,
              (dcv.first_votes * 100.0 / NULLIF(mce.valid_first, 0))::double precision AS percent_of_valid,
              sac.seat_type
       FROM mv_00_direct_candidacy_votes dcv
       JOIN persons p ON p.id = dcv.person_id
       JOIN parties pt ON pt.id = dcv.party_id
       JOIN mv_03_constituency_elections mce ON mce.constituency_id = dcv.constituency_id AND mce.year = dcv.year
       LEFT JOIN seat_allocation_cache sac ON sac.person_id = dcv.person_id AND sac.year = dcv.year
       WHERE dcv.constituency_id = $1 AND dcv.year = $2
       ORDER BY dcv.first_votes DESC
       LIMIT 1`,
      [constituencyId, year]
    );

    // 4. Vote distribution by party (with diff from previous year)
    const voteDistRes = await pool.query(
      `WITH prev_year AS (
         SELECT MAX(year) AS year FROM elections WHERE year < $2
       ),
       -- Constituency matching logic for comparing across years
       current_const AS (
         SELECT c.id, c.number, c.state_id,
           replace(replace(replace(lower(regexp_replace(translate(replace(c.name, 'ß', 'ss'), 'ÄÖÜäöü', 'AOUaou'), '[^A-Za-z0-9]+', '', 'g')), 'ae', 'a'), 'oe', 'o'), 'ue', 'u') AS norm_name
         FROM constituencies c WHERE c.id = $1
       ),
       prev_const AS (
         SELECT c.id, c.number, c.state_id,
           replace(replace(replace(lower(regexp_replace(translate(replace(c.name, 'ß', 'ss'), 'ÄÖÜäöü', 'AOUaou'), '[^A-Za-z0-9]+', '', 'g')), 'ae', 'a'), 'oe', 'o'), 'ue', 'u') AS norm_name
         FROM constituencies c
         JOIN constituency_elections ce ON ce.constituency_id = c.id AND ce.year = (SELECT year FROM prev_year)
       ),
       matched_prev AS (
         SELECT COALESCE(
           (SELECT id FROM prev_const WHERE norm_name = curr.norm_name AND state_id = curr.state_id LIMIT 1),
           (SELECT id FROM prev_const WHERE number = curr.number AND state_id = curr.state_id LIMIT 1),
           (SELECT id FROM prev_const WHERE norm_name = curr.norm_name LIMIT 1)
         ) AS prev_id FROM current_const curr
       ),
       current_totals AS (
         SELECT valid_first, valid_second FROM mv_03_constituency_elections WHERE constituency_id = $1 AND year = $2
       ),
       prev_totals AS (
         SELECT valid_first, valid_second FROM mv_03_constituency_elections
         WHERE constituency_id = (SELECT prev_id FROM matched_prev) AND year = (SELECT year FROM prev_year)
       ),
       current_first AS (SELECT party_id, votes FROM mv_01_constituency_party_votes WHERE constituency_id = $1 AND year = $2 AND vote_type = 1),
       current_second AS (SELECT party_id, votes FROM mv_01_constituency_party_votes WHERE constituency_id = $1 AND year = $2 AND vote_type = 2),
       prev_first AS (SELECT party_id, votes FROM mv_01_constituency_party_votes WHERE constituency_id = (SELECT prev_id FROM matched_prev) AND year = (SELECT year FROM prev_year) AND vote_type = 1),
       prev_second AS (SELECT party_id, votes FROM mv_01_constituency_party_votes WHERE constituency_id = (SELECT prev_id FROM matched_prev) AND year = (SELECT year FROM prev_year) AND vote_type = 2)
       SELECT
         p.short_name AS party_name,
         COALESCE(cf.votes, 0) AS first_votes,
         COALESCE((cf.votes * 100.0 / NULLIF(ct.valid_first, 0))::double precision, 0) AS first_percent,
         COALESCE(cs.votes, 0) AS second_votes,
         COALESCE((cs.votes * 100.0 / NULLIF(ct.valid_second, 0))::double precision, 0) AS second_percent,
         CASE WHEN ct.valid_first > 0 AND pt.valid_first > 0 AND pf.votes IS NOT NULL
           THEN ((COALESCE(cf.votes, 0) * 100.0 / ct.valid_first) - (pf.votes * 100.0 / pt.valid_first))::double precision
         END AS first_diff_pts,
         CASE WHEN ct.valid_second > 0 AND pt.valid_second > 0 AND ps.votes IS NOT NULL
           THEN ((COALESCE(cs.votes, 0) * 100.0 / ct.valid_second) - (ps.votes * 100.0 / pt.valid_second))::double precision
         END AS second_diff_pts
       FROM parties p
       LEFT JOIN current_first cf ON cf.party_id = p.id
       LEFT JOIN current_second cs ON cs.party_id = p.id
       LEFT JOIN prev_first pf ON pf.party_id = p.id
       LEFT JOIN prev_second ps ON ps.party_id = p.id
       LEFT JOIN current_totals ct ON true
       LEFT JOIN prev_totals pt ON true
       WHERE (cf.votes IS NOT NULL OR cs.votes IS NOT NULL)
       ORDER BY cs.votes DESC NULLS LAST`,
      [constituencyId, year]
    );

    // 5. Comparison to previous election (if available)
    let comparison = null;
    const prevYearRes = await pool.query(`SELECT MAX(year) as year FROM elections WHERE year < $1`, [year]);
    const prevYear = prevYearRes.rows[0]?.year;

    if (prevYear) {
      const prevRes = await pool.query(
        `WITH current_const AS (
           SELECT c.id, c.number, c.state_id,
             replace(replace(replace(lower(regexp_replace(translate(replace(c.name, 'ß', 'ss'), 'ÄÖÜäöü', 'AOUaou'), '[^A-Za-z0-9]+', '', 'g')), 'ae', 'a'), 'oe', 'o'), 'ue', 'u') AS norm_name
           FROM constituencies c WHERE c.id = $1
         ),
         prev_const AS (
           SELECT c.id, c.number, c.state_id,
             replace(replace(replace(lower(regexp_replace(translate(replace(c.name, 'ß', 'ss'), 'ÄÖÜäöü', 'AOUaou'), '[^A-Za-z0-9]+', '', 'g')), 'ae', 'a'), 'oe', 'o'), 'ue', 'u') AS norm_name
           FROM constituencies c
           JOIN constituency_elections ce ON ce.constituency_id = c.id AND ce.year = $2
         ),
         matched AS (
           SELECT COALESCE(
             (SELECT id FROM prev_const WHERE norm_name = curr.norm_name AND state_id = curr.state_id LIMIT 1),
             (SELECT id FROM prev_const WHERE number = curr.number AND state_id = curr.state_id LIMIT 1),
             (SELECT id FROM prev_const WHERE norm_name = curr.norm_name LIMIT 1)
           ) AS prev_id FROM current_const curr
         ),
         stats_prev AS (
           SELECT ce.eligible_voters,
             (COALESCE(mce.valid_first, 0) + COALESCE(mce.invalid_first, 0)) AS total_voters,
             CASE WHEN ce.eligible_voters > 0 THEN ((COALESCE(mce.valid_first, 0) + COALESCE(mce.invalid_first, 0)) * 100.0 / ce.eligible_voters) END AS turnout_percent
           FROM constituency_elections ce
           LEFT JOIN mv_03_constituency_elections mce ON mce.constituency_id = ce.constituency_id AND mce.year = ce.year
           WHERE ce.constituency_id = (SELECT prev_id FROM matched) AND ce.year = $2
         )
         SELECT
           stats_prev.turnout_percent,
           dcv.person_id,
           p.first_name || ' ' || p.last_name AS winner_prev
         FROM stats_prev
         CROSS JOIN matched m
         JOIN mv_00_direct_candidacy_votes dcv ON dcv.constituency_id = m.prev_id AND dcv.year = $2
         JOIN persons p ON p.id = dcv.person_id
         ORDER BY dcv.first_votes DESC
         LIMIT 1`,
        [constituencyId, prevYear]
      );

      if (prevRes.rows.length > 0) {
        const turnoutPrev = Number(prevRes.rows[0].turnout_percent);
        const turnoutCurrent = Number(statsRes.rows[0]?.turnout_percent || 0);
        comparison = {
          turnout_diff_pts: turnoutCurrent - turnoutPrev,
          winner_prev: prevRes.rows[0].winner_prev,
          [`winner_${prevYear}`]: prevRes.rows[0].winner_prev,
          winner_changed: prevRes.rows[0].person_id !== winnerRes.rows[0]?.person_id,
        };
      }
    }

    res.json({
      constituency: constRes.rows[0],
      election_stats: statsRes.rows[0] || {},
      winner: winnerRes.rows[0] ? {
        ...winnerRes.rows[0],
        got_seat: !!winnerRes.rows[0]?.seat_type,
      } : null,
      vote_distribution: voteDistRes.rows,
      comparison_to_previous: comparison,
      [`comparison_to_${prevYear}`]: comparison,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'db_error' });
  }
});

/**
 * GET /api/constituency-winners - Winners per constituency (Q4).
 */
router.get('/constituency-winners', ensureCacheMiddleware, async (req, res) => {
  const year = req.query.year ? Number(req.query.year) : 2025;
  const stateId = req.query.state_id ? Number(req.query.state_id) : null;

  try {
    const stateFilter = stateId ? 'AND c.state_id = $2' : '';
    const params = stateId ? [year, stateId] : [year];

    const result = await pool.query(
      `WITH ConstituencyWinners AS (
         SELECT
           dcv.constituency_id, dcv.person_id, dcv.party_id, dcv.first_votes,
           ROW_NUMBER() OVER (PARTITION BY dcv.constituency_id ORDER BY dcv.first_votes DESC, dcv.person_id ASC) AS rank
         FROM mv_00_direct_candidacy_votes dcv
         WHERE dcv.year = $1
       )
       SELECT
         s.name AS state_name,
         c.number AS constituency_number,
         c.name AS constituency_name,
         p.first_name || ' ' || p.last_name AS winner_name,
         pt.short_name AS party_name,
         cw.first_votes,
         (cw.first_votes * 100.0 / NULLIF(mce.valid_first, 0))::double precision AS percent_of_valid,
         CASE WHEN sac.id IS NOT NULL THEN true ELSE false END AS got_seat
       FROM ConstituencyWinners cw
       JOIN constituencies c ON c.id = cw.constituency_id
       JOIN states s ON s.id = c.state_id
       JOIN persons p ON p.id = cw.person_id
       JOIN parties pt ON pt.id = cw.party_id
       JOIN mv_03_constituency_elections mce ON mce.constituency_id = cw.constituency_id AND mce.year = $1
       LEFT JOIN seat_allocation_cache sac ON sac.person_id = cw.person_id AND sac.year = $1
       WHERE cw.rank = 1 ${stateFilter}
       ORDER BY s.name, c.number`,
      params
    );

    res.json({ data: result.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'db_error' });
  }
});

/**
 * GET /api/constituency-votes-bulk - Bulk vote distribution for map visualization.
 */
router.get('/constituency-votes-bulk', async (req, res) => {
  const year = req.query.year ? Number(req.query.year) : 2025;

  try {
    const result = await pool.query(
      `WITH totals AS (
         SELECT constituency_id, valid_first, valid_second
         FROM mv_03_constituency_elections WHERE year = $1
       ),
       combined_votes AS (
         SELECT constituency_id, party_id,
           COALESCE(SUM(CASE WHEN vote_type = 1 THEN votes ELSE 0 END), 0) AS first_votes,
           COALESCE(SUM(CASE WHEN vote_type = 2 THEN votes ELSE 0 END), 0) AS second_votes
         FROM mv_01_constituency_party_votes WHERE year = $1
         GROUP BY constituency_id, party_id
       ),
       Combined AS (
         SELECT c.number AS constituency_number, p.short_name AS party_name,
           COALESCE(cv.first_votes, 0) AS first_votes,
           COALESCE(cv.second_votes, 0) AS second_votes,
           COALESCE((cv.first_votes * 100.0 / NULLIF(t.valid_first, 0))::double precision, 0) AS first_percent,
           COALESCE((cv.second_votes * 100.0 / NULLIF(t.valid_second, 0))::double precision, 0) AS second_percent
         FROM combined_votes cv
         JOIN constituencies c ON c.id = cv.constituency_id
         JOIN parties p ON p.id = cv.party_id
         JOIN totals t ON t.constituency_id = cv.constituency_id
       ),
       RankedFirst AS (
         SELECT *, ROW_NUMBER() OVER (PARTITION BY constituency_number ORDER BY first_votes DESC) AS rank_first FROM Combined
       ),
       RankedSecond AS (
         SELECT *, ROW_NUMBER() OVER (PARTITION BY constituency_number ORDER BY second_votes DESC) AS rank_second FROM Combined
       )
       SELECT rf.constituency_number, rf.party_name, rf.first_votes, rf.second_votes,
         COALESCE(rf.first_percent, 0) AS first_percent, COALESCE(rf.second_percent, 0) AS second_percent,
         rf.rank_first, rs.rank_second
       FROM RankedFirst rf
       JOIN RankedSecond rs ON rf.constituency_number = rs.constituency_number AND rf.party_name = rs.party_name
       ORDER BY rf.constituency_number, rf.first_votes DESC`,
      [year]
    );

    // Group by constituency
    const constituencies: Record<number, { constituency_number: number; parties: Array<any> }> = {};
    for (const row of result.rows) {
      const num = row.constituency_number;
      if (!constituencies[num]) {
        constituencies[num] = { constituency_number: num, parties: [] };
      }
      constituencies[num].parties.push({
        party_name: row.party_name,
        first_votes: parseInt(row.first_votes),
        second_votes: parseInt(row.second_votes),
        first_percent: parseFloat(row.first_percent),
        second_percent: parseFloat(row.second_percent),
        rank_first: parseInt(row.rank_first),
        rank_second: parseInt(row.rank_second),
      });
    }

    res.json({ data: Object.values(constituencies) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'db_error' });
  }
});

export default router;
