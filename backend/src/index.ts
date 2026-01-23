import express from "express";
import dbModule from "./db";
const { pool } = dbModule;

// helper modules
import { ensureCacheExists } from "./services/cacheSeats";

const app = express();
app.use(express.json());

app.get("/api/health", async (_req, res) => {
  try {
    await pool.query("SELECT 1");
    res.json({ status: "ok" });
  } catch {
    res.status(500).json({ status: "db_error" });
  }
});

// Middleware: ensure cache exists for requested year
async function ensureCache(req: express.Request, res: express.Response, next: express.NextFunction) {
  const year = req.query.year ? Number(req.query.year) : 2025;
  try {
    await ensureCacheExists(year);
    next();
  } catch (err) {
    console.error('Cache population failed:', err);
    res.status(500).json({ error: 'cache_error' });
  }
}

// Q1: Seat distribution (optimized with cache)
app.get('/api/seats', ensureCache, async (req, res) => {
  const year = req.query.year ? Number(req.query.year) : 2025;

  try {
    const result = await pool.query(`
      SELECT
        p.id as party_id,
        p.short_name as party_name,
        COUNT(*) as seats
      FROM seat_allocation_cache sac
      JOIN parties p ON p.id = sac.party_id
      WHERE sac.year = $1
      GROUP BY p.id, p.short_name
      ORDER BY seats DESC
    `, [year]);

    res.json({
      data: result.rows.map(r => ({
        party_id: r.party_id,
        party_name: r.party_name,
        seats: parseInt(r.seats)
      }))
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'db_error' });
  }
});

// Q2: Members of the Bundestag (optimized with cache)
app.get('/api/members', ensureCache, async (req, res) => {
  const year = req.query.year ? Number(req.query.year) : 2025;

  try {
    const result = await pool.query(`
      SELECT
        sac.person_id,
        p.title,
        p.first_name,
        p.last_name,
        p.profession,
        p.birth_year,
        p.gender,
        pt.id as party_id,
        pt.short_name as party_name,
        pt.long_name as party_long_name,
        s.id as state_id,
        s.name as state_name,
        sac.seat_type,
        COALESCE(
          sac.constituency_name,
          top_second_votes.constituency_name
        ) AS constituency_name,
        sac.list_position,
        sac.percent_first_votes,
        COALESCE(prev_seat.is_prev, false) as previously_elected
      FROM seat_allocation_cache sac
      JOIN persons p ON p.id = sac.person_id
      JOIN parties pt ON pt.id = sac.party_id
      JOIN states s ON s.id = sac.state_id
      LEFT JOIN LATERAL (
        SELECT e2.year AS prev_year
        FROM elections e2
        WHERE e2.year < $1
        ORDER BY e2.year DESC
        LIMIT 1
      ) prev_year ON true
      LEFT JOIN LATERAL (
        SELECT true AS is_prev
        FROM seat_allocation_cache prev
        WHERE prev.person_id = sac.person_id
          AND prev.year = prev_year.prev_year
        LIMIT 1
      ) prev_seat ON true
      LEFT JOIN LATERAL (
        SELECT
          c2.name AS constituency_name
        FROM mv_01_constituency_party_votes cpv2
        JOIN constituencies c2 ON c2.id = cpv2.constituency_id
        WHERE
          cpv2.year = $1
          AND c2.state_id = sac.state_id
          AND cpv2.vote_type = 2
          AND cpv2.party_id = sac.party_id
        ORDER BY cpv2.votes DESC
        LIMIT 1
      ) top_second_votes ON true
      WHERE sac.year = $1
      ORDER BY pt.short_name, s.name, p.last_name, p.first_name
    `, [year]);

    res.json({ data: result.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'db_error' });
  }
});


app.get('/api/constituency/:id/parties', async (req, res) => {
  const constituencyId = Number(req.params.id);
  const year = req.query.year ? Number(req.query.year) : 2025;

  try {
    const result = await pool.query(
      `SELECT p.id, p.short_name, p.long_name, cpv.votes AS votes, cpv.vote_type
       FROM mv_01_constituency_party_votes cpv
       JOIN parties p ON cpv.party_id = p.id
       WHERE cpv.constituency_id = $1 AND cpv.year = $2 AND cpv.vote_type = 2
       ORDER BY p.short_name`,
      [constituencyId, year]
    );

    res.json({ data: result.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'db_error' });
  }
});

// Constituency list for selection/autocomplete
app.get('/api/constituencies', async (req, res) => {
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

app.get('/api/constituency/:id/candidates', async (req, res) => {
  const constituencyId = Number(req.params.id);
  const year = req.query.year ? Number(req.query.year) : 2025;

  try {
    const result = await pool.query(
      `SELECT
         per.id AS person_id,
         per.title,
         per.first_name,
         per.last_name,
         dcv.party_id,
         p.short_name,
         p.long_name,
         dcv.first_votes,
         COALESCE(prev_seat.is_prev, false) AS previously_elected
       FROM mv_00_direct_candidacy_votes dcv
       JOIN persons per ON per.id = dcv.person_id
       JOIN parties p ON p.id = dcv.party_id
       LEFT JOIN LATERAL (
         SELECT e2.year AS prev_year
         FROM elections e2
         WHERE e2.year < $2
         ORDER BY e2.year DESC
         LIMIT 1
       ) prev_year ON true
       LEFT JOIN LATERAL (
         SELECT true AS is_prev
         FROM seat_allocation_cache prev
         WHERE prev.person_id = dcv.person_id
           AND prev.year = prev_year.prev_year
         LIMIT 1
       ) prev_seat ON true
       WHERE dcv.constituency_id = $1 AND dcv.year = $2
       ORDER BY dcv.first_votes DESC NULLS LAST, per.last_name, per.first_name`,
      [constituencyId, year]
    );

    res.json({ data: result.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'db_error' });
  }
});

app.get('/api/constituency/:id', async (req, res) => {
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

// Q3: Constituency Overview
app.get('/api/constituency/:id/overview', ensureCache, async (req, res) => {
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

    // 4. Vote distribution by party (including diff_percent_pts from 2021)
    const voteDistRes = await pool.query(
      `WITH prev_year AS (
         SELECT MAX(year) AS year
         FROM elections
         WHERE year < $2
       ),
       current_totals AS (
         SELECT valid_first, valid_second
         FROM mv_03_constituency_elections
         WHERE constituency_id = $1 AND year = $2
       ),
       prev_totals AS (
         SELECT valid_first, valid_second
         FROM mv_03_constituency_elections
         WHERE constituency_id = $1 AND year = (SELECT year FROM prev_year)
       ),
       current_first AS (
         SELECT party_id, votes
         FROM mv_01_constituency_party_votes
         WHERE constituency_id = $1 AND year = $2 AND vote_type = 1
       ),
       current_second AS (
         SELECT party_id, votes
         FROM mv_01_constituency_party_votes
         WHERE constituency_id = $1 AND year = $2 AND vote_type = 2
       ),
       prev_first AS (
         SELECT party_id, votes
         FROM mv_01_constituency_party_votes
         WHERE constituency_id = $1 AND year = (SELECT year FROM prev_year) AND vote_type = 1
       ),
       prev_second AS (
         SELECT party_id, votes
         FROM mv_01_constituency_party_votes
         WHERE constituency_id = $1 AND year = (SELECT year FROM prev_year) AND vote_type = 2
       )
       SELECT
         p.short_name AS party_name,
         COALESCE(cf.votes, 0) AS first_votes,
         COALESCE((COALESCE(cf.votes, 0) * 100.0 / NULLIF(ct.valid_first, 0))::double precision, 0) AS first_percent,
         COALESCE(cs.votes, 0) AS second_votes,
         COALESCE((COALESCE(cs.votes, 0) * 100.0 / NULLIF(ct.valid_second, 0))::double precision, 0) AS second_percent,
         CASE
           WHEN ct.valid_first IS NULL OR ct.valid_first = 0
             OR pt.valid_first IS NULL OR pt.valid_first = 0
             OR pf.votes IS NULL THEN NULL
           ELSE ((COALESCE(cf.votes, 0) * 100.0 / ct.valid_first) - (pf.votes * 100.0 / pt.valid_first))::double precision
         END AS first_diff_pts,
         CASE
           WHEN ct.valid_second IS NULL OR ct.valid_second = 0
             OR pt.valid_second IS NULL OR pt.valid_second = 0
             OR ps.votes IS NULL THEN NULL
           ELSE ((COALESCE(cs.votes, 0) * 100.0 / ct.valid_second) - (ps.votes * 100.0 / pt.valid_second))::double precision
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

    // 5. Comparison to 2021 (if available) - match by number first, then by name
    let comparison = null;
    if (year === 2025) {
      const currentConstituency = constRes.rows[0];

      // Try to find matching 2021 constituency by number first, then by name similarity
      const prevRes = await pool.query(
        `WITH matching_2021_constituency AS (
           SELECT c2021.id as constituency_id, 1 as match_priority
           FROM constituencies c2021
           JOIN constituency_elections ce2021
             ON ce2021.constituency_id = c2021.id
            AND ce2021.year = 2021
           WHERE c2021.number = $1
           UNION ALL
           SELECT c2021.id as constituency_id, 2 as match_priority
           FROM constituencies c2021
           JOIN constituency_elections ce2021
             ON ce2021.constituency_id = c2021.id
            AND ce2021.year = 2021
           WHERE c2021.name = $2
             AND NOT EXISTS (
               SELECT 1 FROM constituencies cx
               JOIN constituency_elections cex
                 ON cex.constituency_id = cx.id
                AND cex.year = 2021
               WHERE cx.number = $1
             )
           ORDER BY match_priority
           LIMIT 1
         ),
         stats_2021 AS (
           SELECT
             ce.constituency_id,
             ce.eligible_voters,
             (COALESCE(mce.valid_first, 0) + COALESCE(mce.invalid_first, 0)) AS total_voters,
             CASE
               WHEN ce.eligible_voters IS NULL OR ce.eligible_voters = 0 THEN NULL
               ELSE ((COALESCE(mce.valid_first, 0) + COALESCE(mce.invalid_first, 0)) * 100.0 / ce.eligible_voters)
             END AS turnout_percent
           FROM constituency_elections ce
           LEFT JOIN mv_03_constituency_elections mce
             ON mce.constituency_id = ce.constituency_id
            AND mce.year = ce.year
           WHERE ce.year = 2021
         )
         SELECT stats_2021.turnout_percent as turnout_percent,
                dcv2021.person_id,
                p2021.first_name || ' ' || p2021.last_name AS winner_2021,
                c2021.name AS matched_constituency_name
         FROM matching_2021_constituency m
         JOIN constituencies c2021 ON c2021.id = m.constituency_id
         JOIN stats_2021 ON stats_2021.constituency_id = m.constituency_id
         JOIN mv_00_direct_candidacy_votes dcv2021
           ON dcv2021.constituency_id = stats_2021.constituency_id
          AND dcv2021.year = 2021
         JOIN persons p2021 ON p2021.id = dcv2021.person_id
         ORDER BY dcv2021.first_votes DESC
         LIMIT 1`,
        [currentConstituency.number, currentConstituency.name]
      );

      if (prevRes.rows.length > 0) {
        const turnout2021 = Number(prevRes.rows[0].turnout_percent);
        const turnout2025 = Number(statsRes.rows[0]?.turnout_percent || 0);
        comparison = {
          turnout_diff_pts: turnout2025 - turnout2021,
          winner_2021: prevRes.rows[0].winner_2021,
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
      comparison_to_2021: comparison,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'db_error' });
  }
});

// Q4: Constituency Winners Per District
app.get('/api/constituency-winners', ensureCache, async (req, res) => {
  const year = req.query.year ? Number(req.query.year) : 2025;
  const stateId = req.query.state_id ? Number(req.query.state_id) : null;

  try {
    const stateFilter = stateId ? 'AND c.state_id = $2' : '';
    const params = stateId ? [year, stateId] : [year];

    const result = await pool.query(
      `WITH ConstituencyWinners AS (
         SELECT
           dcv.constituency_id,
           dcv.person_id,
           dcv.party_id,
           dcv.first_votes,
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

// Q5: Direct Mandates Without Second-Vote Coverage
app.get('/api/direct-without-coverage', ensureCache, async (req, res) => {
  const year = req.query.year ? Number(req.query.year) : 2025;

  try {
    // Find constituency winners who did NOT get a seat (second-vote coverage)
    // Also get their party's second votes in that constituency
    const result = await pool.query(
      `WITH ConstituencyWinners AS (
         SELECT
           dcv.constituency_id,
           dcv.person_id,
           dcv.party_id,
           dcv.first_votes,
           ROW_NUMBER() OVER (PARTITION BY dcv.constituency_id ORDER BY dcv.first_votes DESC) AS rank
         FROM mv_00_direct_candidacy_votes dcv
         WHERE dcv.year = $1 AND dcv.first_votes IS NOT NULL AND dcv.first_votes > 0
       )
       SELECT
         c.number AS constituency_number,
         c.name AS constituency_name,
         p.first_name || ' ' || p.last_name AS winner_name,
         pt.short_name AS party_name,
         s.name AS state_name,
         cw.first_votes,
         (cw.first_votes * 100.0 / NULLIF(mce.valid_first, 0))::double precision AS percent_first_votes,
         COALESCE(cpv2.votes, 0) AS party_second_votes,
         COALESCE((COALESCE(cpv2.votes, 0) * 100.0 / NULLIF(mce.valid_second, 0))::double precision, 0) AS party_second_percent
       FROM ConstituencyWinners cw
       JOIN constituencies c ON c.id = cw.constituency_id
       JOIN states s ON s.id = c.state_id
       JOIN persons p ON p.id = cw.person_id
       JOIN parties pt ON pt.id = cw.party_id
       JOIN mv_03_constituency_elections mce ON mce.constituency_id = cw.constituency_id AND mce.year = $1
       LEFT JOIN mv_01_constituency_party_votes cpv2
         ON cpv2.constituency_id = cw.constituency_id
         AND cpv2.year = $1
         AND cpv2.party_id = cw.party_id
         AND cpv2.vote_type = 2
       LEFT JOIN seat_allocation_cache sac ON sac.person_id = cw.person_id
         AND sac.year = $1
         AND sac.seat_type LIKE '%Direct Mandate%'
       WHERE cw.rank = 1 AND sac.id IS NULL
       ORDER BY cw.first_votes DESC`,
      [year]
    );

    res.json({
      data: result.rows,
      total_lost_mandates: result.rows.length,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'db_error' });
  }
});

// Q6: Near-misses for parties without constituency wins
app.get('/api/near-misses', async (req, res) => {
  const year = req.query.year ? Number(req.query.year) : 2025;
  const limit = req.query.limit ? Number(req.query.limit) : 10;

  try {
    const result = await pool.query(
      `WITH RankedCandidates AS (
         SELECT
           c.id AS constituency_id,
           c.number AS constituency_number,
           c.name AS constituency_name,
           s.name AS state_name,
           dcv.person_id,
           dcv.party_id,
           dcv.first_votes,
           ROW_NUMBER() OVER (PARTITION BY dcv.constituency_id ORDER BY dcv.first_votes DESC, dcv.person_id ASC) AS rank
         FROM mv_00_direct_candidacy_votes dcv
         JOIN constituencies c ON c.id = dcv.constituency_id
         JOIN states s ON s.id = c.state_id
         WHERE dcv.year = $1 AND dcv.first_votes IS NOT NULL AND dcv.first_votes > 0
       ),
       Winners AS (SELECT * FROM RankedCandidates WHERE rank = 1),
       -- Parties that have zero constituency wins
       PartiesWithoutWins AS (
         SELECT DISTINCT dcv.party_id
         FROM mv_00_direct_candidacy_votes dcv
         WHERE dcv.year = $1 AND dcv.first_votes IS NOT NULL
         EXCEPT
         SELECT DISTINCT party_id FROM Winners
       ),
       -- Get best performances for parties without wins (runner-ups)
       NearMisses AS (
         SELECT
           rc.constituency_id,
           rc.constituency_number,
           rc.constituency_name,
           rc.state_name,
           rc.person_id,
           rc.party_id,
           rc.first_votes,
           rc.rank,
           w.first_votes AS winner_votes,
           (w.first_votes - rc.first_votes) AS margin_votes,
           ((w.first_votes - rc.first_votes) * 100.0 / NULLIF(mce.valid_first, 0))::double precision AS margin_percent
         FROM RankedCandidates rc
         JOIN PartiesWithoutWins pww ON pww.party_id = rc.party_id
         JOIN Winners w ON w.constituency_id = rc.constituency_id
         JOIN mv_03_constituency_elections mce ON mce.constituency_id = rc.constituency_id AND mce.year = $1
         WHERE rc.rank > 1
       )
       SELECT
         ROW_NUMBER() OVER (PARTITION BY nm.party_id ORDER BY nm.margin_votes ASC) AS party_rank,
         nm.constituency_number,
         nm.constituency_name,
         nm.state_name,
         p.first_name || ' ' || p.last_name AS candidate_name,
         pt.short_name AS party_name,
         nm.first_votes AS candidate_votes,
         nm.winner_votes,
         nm.margin_votes,
         nm.margin_percent
       FROM NearMisses nm
       JOIN persons p ON p.id = nm.person_id
       JOIN parties pt ON pt.id = nm.party_id
       ORDER BY pt.short_name, nm.margin_votes ASC`,
      [year]
    );

    // Group by party
    const grouped: Record<string, typeof result.rows> = {};
    for (const row of result.rows) {
      if (!grouped[row.party_name]) {
        grouped[row.party_name] = [];
      }
      if (grouped[row.party_name].length < limit) {
        grouped[row.party_name].push(row);
      }
    }

    res.json({ data: grouped });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'db_error' });
  }
});

// Q6: Top 10 Closest Winners
app.get('/api/closest-winners', async (req, res) => {
  const year = req.query.year ? Number(req.query.year) : 2025;
  const limit = req.query.limit ? Number(req.query.limit) : 10;

  try {
    const result = await pool.query(
      `WITH RankedCandidates AS (
         SELECT
           c.id AS constituency_id,
           c.name AS constituency_name,
           s.name AS state_name,
           dcv.person_id,
           dcv.party_id,
           dcv.first_votes,
           ROW_NUMBER() OVER (PARTITION BY dcv.constituency_id ORDER BY dcv.first_votes DESC, dcv.person_id ASC) AS rank
         FROM mv_00_direct_candidacy_votes dcv
         JOIN constituencies c ON c.id = dcv.constituency_id
         JOIN states s ON s.id = c.state_id
         WHERE dcv.year = $1 AND dcv.first_votes IS NOT NULL AND dcv.first_votes > 0
       ),
       Winners AS (SELECT * FROM RankedCandidates WHERE rank = 1),
       RunnersUp AS (SELECT * FROM RankedCandidates WHERE rank = 2)
       SELECT
         ROW_NUMBER() OVER (ORDER BY (w.first_votes - r.first_votes) ASC) AS rank,
         w.constituency_name,
         w.state_name,
         wp.first_name || ' ' || wp.last_name AS winner_name,
         wparty.short_name AS winner_party,
         w.first_votes AS winner_votes,
         rp.first_name || ' ' || rp.last_name AS runner_up_name,
         rparty.short_name AS runner_up_party,
         r.first_votes AS runner_up_votes,
         (w.first_votes - r.first_votes) AS margin_votes,
         ((w.first_votes - r.first_votes) * 100.0 / NULLIF(mce.valid_first, 0))::double precision AS margin_percent
       FROM Winners w
       JOIN RunnersUp r ON r.constituency_id = w.constituency_id
       JOIN persons wp ON wp.id = w.person_id
       JOIN persons rp ON rp.id = r.person_id
       JOIN parties wparty ON wparty.id = w.party_id
       JOIN parties rparty ON rparty.id = r.party_id
       JOIN mv_03_constituency_elections mce ON mce.constituency_id = w.constituency_id AND mce.year = $1
       ORDER BY margin_votes ASC
       LIMIT $2`,
      [year, limit]
    );

    res.json({ data: result.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'db_error' });
  }
});

// Q7: Constituency Overview Based on Individual Votes
app.get('/api/constituencies-single', async (req, res) => {
  const year = req.query.year ? Number(req.query.year) : 2025;
  const idsParam = req.query.ids as string;
  // The frontend passes constituency "number" values (public numbers), not internal DB ids
  const ids = idsParam ? idsParam.split(',').map(Number) : null;

  try {
    // Filter by constituency number (c.number), not internal constituency id
    const idsFilter = ids ? 'AND c.number = ANY($2)' : '';
    const params = ids ? [year, ids] : [year];

    // Query first votes (individual ballot counts)
    const firstVotesRes = await pool.query(
      `SELECT
         dc.constituency_id,
         c.name AS constituency_name,
         s.name AS state_name,
         dc.person_id,
         p.first_name || ' ' || p.last_name AS person_name,
         pt.short_name AS party_name,
         COUNT(fv.id) AS vote_count,
         RANK() OVER (PARTITION BY dc.constituency_id ORDER BY COUNT(fv.id) DESC) AS rank
       FROM first_votes fv
       JOIN direct_candidacy dc ON dc.person_id = fv.direct_person_id AND dc.year = fv.year
       JOIN persons p ON p.id = dc.person_id
       JOIN parties pt ON pt.id = dc.party_id
       JOIN constituencies c ON c.id = dc.constituency_id
       JOIN states s ON s.id = c.state_id
       WHERE fv.year = $1 AND fv.is_valid = true ${idsFilter}
       GROUP BY dc.constituency_id, c.name, s.name, dc.person_id, p.first_name, p.last_name, pt.short_name
       ORDER BY dc.constituency_id, vote_count DESC`,
      params
    );

    // Query second votes by constituency (party lists)
    const secondVotesRes = await pool.query(
      `SELECT
         c.id AS constituency_id,
         c.name AS constituency_name,
         s.name AS state_name,
         pl.party_id,
         pt.short_name AS party_name,
         COUNT(sv.id) AS vote_count
       FROM second_votes sv
       JOIN party_lists pl ON pl.id = sv.party_list_id
       JOIN parties pt ON pt.id = pl.party_id
       JOIN constituencies c ON c.id = sv.constituency_id
       JOIN states s ON s.id = c.state_id
       WHERE pl.year = $1 AND sv.is_valid = true ${idsFilter}
       GROUP BY c.id, c.name, s.name, pl.party_id, pt.short_name
       ORDER BY c.id, vote_count DESC`,
      params
    );

    type ConstituencyCandidateEntry = {
      person_name: string;
      party_name: string;
      vote_count: number;
      is_winner: boolean;
    };

    type ConstituencySecondVoteEntry = {
      party_name: string;
      vote_count: number;
    };

    type ConstituencyAggregateEntry = {
      constituency_id: number;
      constituency_name: string;
      state_name: string;
      candidates: ConstituencyCandidateEntry[];
      party_second_votes: ConstituencySecondVoteEntry[];
      total_first_votes: number;
      total_second_votes: number;
    };

    // Aggregate by constituency
    const constituenciesMap = new Map<number, ConstituencyAggregateEntry>();
    for (const row of firstVotesRes.rows) {
      if (!constituenciesMap.has(row.constituency_id)) {
        constituenciesMap.set(row.constituency_id, {
          constituency_id: row.constituency_id,
          constituency_name: row.constituency_name,
          state_name: row.state_name,
          candidates: [],
          party_second_votes: [],
          total_first_votes: 0,
          total_second_votes: 0,
        });
      }
      const entry = constituenciesMap.get(row.constituency_id);
      if (!entry) continue;
      entry.candidates.push({
        person_name: row.person_name,
        party_name: row.party_name,
        vote_count: Number(row.vote_count),
        is_winner: Number(row.rank) === 1,
      });
      entry.total_first_votes += Number(row.vote_count);
    }

    // Add second votes (by constituency)
    for (const row of secondVotesRes.rows) {
      if (!constituenciesMap.has(row.constituency_id)) {
        constituenciesMap.set(row.constituency_id, {
          constituency_id: row.constituency_id,
          constituency_name: row.constituency_name,
          state_name: row.state_name,
          candidates: [],
          party_second_votes: [],
          total_first_votes: 0,
          total_second_votes: 0,
        });
      }
      const entry = constituenciesMap.get(row.constituency_id);
      if (!entry) continue;

      const existingParty = entry.party_second_votes.find((p) => p.party_name === row.party_name);
      if (!existingParty) {
        entry.party_second_votes.push({
          party_name: row.party_name,
          vote_count: Number(row.vote_count),
        });
        entry.total_second_votes += Number(row.vote_count);
      }
    }

    res.json({ data: Array.from(constituenciesMap.values()) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'db_error' });
  }
});

// Admin: Cache regeneration endpoint
app.post('/api/admin/calculate-seats', async (req, res) => {
  const year = req.query.year ? Number(req.query.year) : 2025;

  try {
    const { refreshSeatCaches } = await import('./services/cacheSeats');
    await refreshSeatCaches();
    const statsRes = await pool.query(
      `SELECT
         COUNT(*)::int AS seats,
         COUNT(DISTINCT party_id)::int AS parties
       FROM seat_allocation_cache
       WHERE year = $1`,
      [year]
    );
    const statsRow = statsRes.rows[0] || { seats: 0, parties: 0 };

    res.json({
      message: 'Cache regenerated successfully',
      year,
      stats: {
        seats: Number(statsRow.seats) || 0,
        parties: Number(statsRow.parties) || 0,
      }
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'cache_regeneration_failed', details: String(err) });
  }
});

// POST: submit a ballot (erst + zweit)
app.post('/api/ballot', async (req, res) => {
  const body = req.body || {};
  const constituencyId = Number(body.constituencyId || 1);
  const year = body.year ? Number(body.year) : 2025;

  try {
    // find constituency and state
    const constRes = await pool.query(
      `SELECT id, number, name, state_id FROM constituencies WHERE id = $1`,
      [constituencyId]
    );
    if (!constRes.rows || constRes.rows.length === 0) {
      return res.status(404).json({ error: 'constituency_not_found' });
    }
    const stateId = constRes.rows[0].state_id;

    // FIRST VOTE handling
    let firstPersonId: number | null = null;
    let firstIsValid: boolean;
    if (body.first && body.first.type === 'candidate' && body.first.person_id) {
      // ensure the direct_candidacy exists for that person/year/constituency
      const check = await pool.query(
        `SELECT 1 FROM direct_candidacy WHERE person_id = $1 AND year = $2 AND constituency_id = $3`,
        [body.first.person_id, year, constituencyId]
      );
      if (!check.rows || check.rows.length === 0) {
        return res.status(400).json({ error: 'invalid_direct_candidate' });
      }
      firstPersonId = Number(body.first.person_id);
      firstIsValid = true;
    } else {
      // invalid first vote: pick any direct_candidacy person for constituency/year to satisfy FK
      const pick = await pool.query(
        `SELECT person_id FROM direct_candidacy WHERE constituency_id = $1 AND year = $2 LIMIT 1`,
        [constituencyId, year]
      );
      if (!pick.rows || pick.rows.length === 0) {
        return res.status(400).json({ error: 'no_direct_candidate_available' });
      }
      firstPersonId = pick.rows[0].person_id;
      firstIsValid = false;
    }

    await pool.query(
      `INSERT INTO first_votes (year, direct_person_id, is_valid) VALUES ($1, $2, $3)`,
      [year, firstPersonId, firstIsValid]
    );

    // SECOND VOTE handling
    let partyListId: number | null = null;
    let secondIsValid: boolean;
    if (body.second && body.second.type === 'party' && body.second.party_id) {
      // find party_list for that party in this state+year
      let plRes = await pool.query(
        `SELECT id FROM party_lists WHERE party_id = $1 AND state_id = $2 AND year = $3 LIMIT 1`,
        [body.second.party_id, stateId, year]
      );
      // fallback: any party_list for that party+year
      if (!plRes.rows || plRes.rows.length === 0) {
        plRes = await pool.query(`SELECT id FROM party_lists WHERE party_id = $1 AND year = $2 LIMIT 1`, [body.second.party_id, year]);
      }
      if (!plRes.rows || plRes.rows.length === 0) {
        return res.status(400).json({ error: 'party_list_not_found' });
      }
      partyListId = plRes.rows[0].id;
      secondIsValid = true;
    } else {
      // invalid second: pick any party_list for the constituency state + year
      const pick = await pool.query(
        `SELECT id FROM party_lists WHERE state_id = $1 AND year = $2 LIMIT 1`,
        [stateId, year]
      );
      if (!pick.rows || pick.rows.length === 0) {
        return res.status(400).json({ error: 'no_party_list_available' });
      }
      partyListId = pick.rows[0].id;
      secondIsValid = false;
    }

    await pool.query(
      `INSERT INTO second_votes (party_list_id, constituency_id, is_valid) VALUES ($1, $2, $3)`,
      [partyListId, constituencyId, secondIsValid]
    );

    res.json({ status: 'ok' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'db_error' });
  }
});

app.get('/api/election-results', async (req, res) => {
  const year = req.query.year ? Number(req.query.year) : 2025;
  const type = req.query.type ? String(req.query.type) : 'second'; // 'first', 'second', 'seats'
  // Support both single state_id (legacy) and state_ids (array)
  const stateIds: number[] = req.query.state_ids
    ? String(req.query.state_ids).split(',').map(Number).filter(n => !isNaN(n))
    : req.query.state_id
      ? [Number(req.query.state_id)]
      : [];
  const mandateType = req.query.mandate_type ? String(req.query.mandate_type) : null; // 'direct', 'list' (seats only)
  const gender = req.query.gender ? String(req.query.gender) : null; // 'm', 'w' (seats only)
  // Support both single party (legacy) and parties (array)
  const parties: string[] = req.query.parties
    ? String(req.query.parties).split(',').filter(p => p.trim())
    : req.query.party
      ? [String(req.query.party)]
      : [];
  const status = req.query.status ? String(req.query.status) : null; // 'new', 'reelected' (seats only)
  const prevYear = year === 2025 ? 2021 : 2017;

  try {
    type ElectionResultsRow = {
      short_name: string;
      long_name: string;
      votes: string | number | null;
    };

    const toInt = (value: unknown): number => {
      if (typeof value === 'number') return Math.trunc(value);
      if (typeof value === 'string') {
        const parsed = parseInt(value, 10);
        return Number.isFinite(parsed) ? parsed : 0;
      }
      return 0;
    };

    const getVotes = async (y: number) => {
      const params: (number | string | null)[] = [y];
      let paramIdx = 2;

      if (type === 'seats') {
        // For seats, we use seat_allocation_cache with extended filters
        const conditions: string[] = ['sac.year = $1'];
        let joins = `
          FROM seat_allocation_cache sac
          JOIN parties p ON p.id = sac.party_id
          JOIN persons per ON per.id = sac.person_id
        `;

        let prevElectionYear: number | null = null;
        if (status) {
          const prevRes = await pool.query<{ year: number | null }>(
            "SELECT MAX(year) as year FROM elections WHERE year < $1",
            [y]
          );
          prevElectionYear = prevRes.rows[0]?.year ?? null;
        }

        if (stateIds.length > 0) {
          const placeholders = stateIds.map(() => `$${paramIdx++}`).join(', ');
          conditions.push(`sac.state_id IN (${placeholders})`);
          params.push(...stateIds);
        }
        if (mandateType) {
          const seatTypeVal = mandateType === 'direct' ? 'Direct Mandate' : 'List Mandate';
          conditions.push(`sac.seat_type = $${paramIdx++}`);
          params.push(seatTypeVal);
        }
        if (gender) {
          conditions.push(`LOWER(per.gender) = $${paramIdx++}`);
          params.push(gender.toLowerCase());
        }
        if (parties.length > 0) {
          // Handle CDU/CSU combined filter - expand it to CDU and CSU
          const expandedParties = parties.flatMap(p => p === 'CDU/CSU' ? ['CDU', 'CSU'] : [p]);
          const placeholders = expandedParties.map(() => `$${paramIdx++}`).join(', ');
          conditions.push(`p.short_name IN (${placeholders})`);
          params.push(...expandedParties);
        }
        if (status) {
          if (prevElectionYear === null) {
            if (status === 'reelected') {
              conditions.push('1 = 0');
            }
          } else {
            joins += `
              LEFT JOIN seat_allocation_cache prev_sac
                ON prev_sac.person_id = sac.person_id
               AND prev_sac.year = $${paramIdx++}
            `;
            params.push(prevElectionYear);

            if (status === 'new') {
              conditions.push('prev_sac.person_id IS NULL');
            } else if (status === 'reelected') {
              conditions.push('prev_sac.person_id IS NOT NULL');
            }
          }
        }

        const query = `
          SELECT
            CASE 
              WHEN p.short_name IN ('CDU', 'CSU') THEN 'CDU/CSU' 
              ELSE p.short_name 
            END as short_name,
            CASE 
              WHEN p.short_name IN ('CDU', 'CSU') THEN 'CDU/CSU' 
              ELSE p.long_name 
            END as long_name,
            COUNT(*) as votes
          ${joins}
          WHERE ${conditions.join(' AND ')}
          GROUP BY 1, 2
          ORDER BY votes DESC
        `;
        const result = await pool.query<ElectionResultsRow>(query, params);
        return result.rows;
      } else {
        // For first/second votes - only state and party filters apply
        const voteType = type === 'first' ? 1 : 2;
        if (voteType === 2) {
          const conditions: string[] = ['plv.year = $1'];
          if (stateIds.length > 0) {
            const placeholders = stateIds.map(() => `$${paramIdx++}`).join(', ');
            conditions.push(`plv.state_id IN (${placeholders})`);
            params.push(...stateIds);
          }
          if (parties.length > 0) {
            const expandedParties = parties.flatMap(p => p === 'CDU/CSU' ? ['CDU', 'CSU'] : [p]);
            const placeholders = expandedParties.map(() => `$${paramIdx++}`).join(', ');
            conditions.push(`p.short_name IN (${placeholders})`);
            params.push(...expandedParties);
          }

          const query = `
            SELECT
              CASE 
                WHEN p.short_name IN ('CDU', 'CSU') THEN 'CDU/CSU' 
                ELSE p.short_name 
              END as short_name,
              CASE 
                WHEN p.short_name IN ('CDU', 'CSU') THEN 'CDU/CSU' 
                ELSE p.long_name 
              END as long_name,
              SUM(plv.second_votes) as votes
            FROM mv_02_party_list_votes plv
            JOIN parties p ON p.id = plv.party_id
            WHERE ${conditions.join(' AND ')}
            GROUP BY 1, 2
            ORDER BY votes DESC
          `;
          const result = await pool.query<ElectionResultsRow>(query, params);
          return result.rows;
        }

        const conditions: string[] = ['pv.year = $1', `pv.vote_type = $2`];
        params.push(voteType);
        paramIdx++;
        if (stateIds.length > 0) {
          const placeholders = stateIds.map(() => `$${paramIdx++}`).join(', ');
          conditions.push(`c.state_id IN (${placeholders})`);
          params.push(...stateIds);
        }
        if (parties.length > 0) {
          const expandedParties = parties.flatMap(p => p === 'CDU/CSU' ? ['CDU', 'CSU'] : [p]);
          const placeholders = expandedParties.map(() => `$${paramIdx++}`).join(', ');
          conditions.push(`p.short_name IN (${placeholders})`);
          params.push(...expandedParties);
        }

        const query = `
          SELECT
            CASE 
              WHEN p.short_name IN ('CDU', 'CSU') THEN 'CDU/CSU' 
              ELSE p.short_name 
            END as short_name,
            CASE 
              WHEN p.short_name IN ('CDU', 'CSU') THEN 'CDU/CSU' 
              ELSE p.long_name 
            END as long_name,
            SUM(pv.votes) as votes
          FROM mv_01_constituency_party_votes pv
          JOIN constituencies c ON c.id = pv.constituency_id
          JOIN parties p ON p.id = pv.party_id
          WHERE ${conditions.join(' AND ')}
          GROUP BY 1, 2
          ORDER BY votes DESC
        `;
        const result = await pool.query<ElectionResultsRow>(query, params);
        return result.rows;
      }
    };

    const [currentVotes, prevVotes] = await Promise.all([
      getVotes(year),
      getVotes(prevYear)
    ]);

    const totalCurrent = currentVotes.reduce((sum, row) => sum + toInt(row.votes), 0);
    const totalPrev = prevVotes.reduce((sum, row) => sum + toInt(row.votes), 0);

    const byShortName = new Map<string, { name: string; abbreviation: string; votes: number; prevVotes: number }>();

    for (const row of currentVotes) {
      byShortName.set(row.short_name, {
        name: row.long_name,
        abbreviation: row.short_name,
        votes: toInt(row.votes),
        prevVotes: 0,
      });
    }

    for (const row of prevVotes) {
      const existing = byShortName.get(row.short_name);
      if (existing) {
        existing.prevVotes = toInt(row.votes);
      } else {
        byShortName.set(row.short_name, {
          name: row.long_name,
          abbreviation: row.short_name,
          votes: 0,
          prevVotes: toInt(row.votes),
        });
      }
    }

    const data = Array.from(byShortName.values())
      .map((entry) => ({
        name: entry.name,
        abbreviation: entry.abbreviation,
        votes: entry.votes,
        percentage: totalCurrent > 0 ? (entry.votes / totalCurrent * 100) : 0,
        prevVotes: entry.prevVotes,
        prevPercentage: totalPrev > 0 ? (entry.prevVotes / totalPrev * 100) : 0,
      }))
      .sort((a, b) => Math.max(b.votes, b.prevVotes) - Math.max(a.votes, a.prevVotes));

    res.json({ data, totalVotes: totalCurrent, prevTotalVotes: totalPrev });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'db_error' });
  }
});

// Bulk Constituency Vote Distribution - returns all parties per constituency for map coloring/tooltips + accurate legend totals
app.get('/api/constituency-votes-bulk', async (req, res) => {
  const year = req.query.year ? Number(req.query.year) : 2025;

  try {
    // Get first and second votes for all parties in all constituencies
    const result = await pool.query(
      `WITH totals AS (
         SELECT constituency_id, valid_first, valid_second
         FROM mv_03_constituency_elections
         WHERE year = $1
       ),
       combined_votes AS (
         SELECT
           constituency_id,
           party_id,
           COALESCE(SUM(CASE WHEN vote_type = 1 THEN votes ELSE 0 END), 0) AS first_votes,
           COALESCE(SUM(CASE WHEN vote_type = 2 THEN votes ELSE 0 END), 0) AS second_votes
         FROM mv_01_constituency_party_votes
         WHERE year = $1
         GROUP BY constituency_id, party_id
       ),
       Combined AS (
         SELECT
           c.number AS constituency_number,
           p.short_name AS party_name,
           COALESCE(cv.first_votes, 0) AS first_votes,
           COALESCE(cv.second_votes, 0) AS second_votes,
           COALESCE((COALESCE(cv.first_votes, 0) * 100.0 / NULLIF(t.valid_first, 0))::double precision, 0) AS first_percent,
           COALESCE((COALESCE(cv.second_votes, 0) * 100.0 / NULLIF(t.valid_second, 0))::double precision, 0) AS second_percent
         FROM combined_votes cv
         JOIN constituencies c ON c.id = cv.constituency_id
         JOIN parties p ON p.id = cv.party_id
         JOIN totals t ON t.constituency_id = cv.constituency_id
       ),
       RankedFirst AS (
         SELECT
           c.constituency_number,
           c.party_name,
           c.first_votes,
           c.second_votes,
           c.first_percent,
           c.second_percent,
           ROW_NUMBER() OVER (PARTITION BY c.constituency_number ORDER BY c.first_votes DESC) AS rank_first
         FROM Combined c
       ),
       RankedSecond AS (
         SELECT
           c.constituency_number,
           c.party_name,
           c.first_votes,
           c.second_votes,
           c.first_percent,
           c.second_percent,
           ROW_NUMBER() OVER (PARTITION BY c.constituency_number ORDER BY c.second_votes DESC) AS rank_second
         FROM Combined c
       )
       SELECT
         rf.constituency_number,
         rf.party_name,
         rf.first_votes,
         rf.second_votes,
         COALESCE(rf.first_percent, 0) AS first_percent,
         COALESCE(rf.second_percent, 0) AS second_percent,
         rf.rank_first,
         rs.rank_second
       FROM RankedFirst rf
       JOIN RankedSecond rs ON rf.constituency_number = rs.constituency_number AND rf.party_name = rs.party_name
       ORDER BY rf.constituency_number, rf.first_votes DESC`,
      [year]
    );

    // Group by constituency
    const constituencies: Record<number, {
      constituency_number: number;
      parties: Array<{
        party_name: string;
        first_votes: number;
        second_votes: number;
        first_percent: number;
        second_percent: number;
        rank_first: number;
        rank_second: number;
      }>;
    }> = {};

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

// Party strength per constituency (for map visualizations)
app.get('/api/party-constituency-strength', async (req, res) => {
  const year = req.query.year ? Number(req.query.year) : 2025;
  const voteType = req.query.vote_type ? Number(req.query.vote_type) : 2;
  const partyParam = typeof req.query.party === 'string' ? req.query.party.trim() : '';

  if (!partyParam) {
    return res.status(400).json({ error: 'missing_party' });
  }

  const normalizedParty = partyParam.toUpperCase();
  const normalizedAliases: Record<string, string[]> = {
    'CDU/CSU': ['CDU', 'CSU'],
    'GRÜNE': ['GRÜNE', 'GRUENE', 'GRUNE'],
    'GRUENE': ['GRÜNE', 'GRUENE', 'GRUNE'],
    'GRUNE': ['GRÜNE', 'GRUENE', 'GRUNE'],
    'DIE LINKE': ['DIE LINKE', 'LINKE'],
    'LINKE': ['DIE LINKE', 'LINKE'],
  };

  const parties = normalizedAliases[normalizedParty]
    ? normalizedAliases[normalizedParty]
    : partyParam.split(',').map((p) => p.trim()).filter(Boolean);

  try {
    const result = await pool.query(
      `WITH party_filter AS (
         SELECT id
         FROM parties
         WHERE UPPER(short_name) = ANY($3)
       ),
       prev_year AS (
         SELECT MAX(year) AS year
         FROM elections
         WHERE year < $1
       ),
       current_constituencies AS (
         SELECT ce.constituency_id, c.number, c.name, c.state_id
         FROM constituency_elections ce
         JOIN constituencies c ON c.id = ce.constituency_id
         WHERE ce.year = $1
       ),
       prev_constituencies AS (
         SELECT ce.constituency_id, c.number, c.name, c.state_id
         FROM constituency_elections ce
         JOIN constituencies c ON c.id = ce.constituency_id
         WHERE ce.year = (SELECT year FROM prev_year)
       ),
       constituency_match AS (
         SELECT
           curr.constituency_id AS current_id,
           COALESCE(prev_num.constituency_id, prev_name.constituency_id) AS prev_id
         FROM current_constituencies curr
         LEFT JOIN prev_constituencies prev_num
           ON prev_num.number = curr.number
          AND prev_num.state_id = curr.state_id
         LEFT JOIN prev_constituencies prev_name
           ON prev_name.name = curr.name
          AND prev_name.state_id = curr.state_id
       ),
       current_votes AS (
         SELECT constituency_id, party_id, vote_type, votes
         FROM mv_01_constituency_party_votes
         WHERE year = $1
       ),
       current_totals AS (
         SELECT constituency_id, valid_first, valid_second, invalid_first
         FROM mv_03_constituency_elections
         WHERE year = $1
       ),
       prev_totals AS (
         SELECT
           cm.current_id AS constituency_id,
           pt.valid_first,
           pt.valid_second
         FROM mv_03_constituency_elections pt
         JOIN constituency_match cm ON cm.prev_id = pt.constituency_id
         WHERE pt.year = (SELECT year FROM prev_year)
       ),
       selected_current AS (
         SELECT cv.constituency_id, cv.vote_type, SUM(cv.votes) AS votes
         FROM current_votes cv
         JOIN party_filter pf ON pf.id = cv.party_id
         GROUP BY cv.constituency_id, cv.vote_type
       ),
       selected_prev AS (
         SELECT
           cm.current_id AS constituency_id,
           pv.vote_type,
           SUM(pv.votes) AS votes
         FROM mv_01_constituency_party_votes pv
         JOIN constituency_match cm ON cm.prev_id = pv.constituency_id
         JOIN party_filter pf ON pf.id = pv.party_id
         WHERE pv.year = (SELECT year FROM prev_year)
         GROUP BY cm.current_id, pv.vote_type
       )
       SELECT
         c.number AS constituency_number,
         c.name AS constituency_name,
         s.name AS state_name,
         COALESCE(sc.votes, 0) AS votes,
         CASE
           WHEN sp.votes IS NULL THEN NULL
           WHEN $2 = 1 THEN
             CASE
               WHEN ct.valid_first IS NULL OR ct.valid_first = 0
                 OR pt.valid_first IS NULL OR pt.valid_first = 0 THEN NULL
               ELSE ((COALESCE(sc.votes, 0) * 100.0 / ct.valid_first) - (sp.votes * 100.0 / pt.valid_first))
             END
           ELSE
             CASE
               WHEN ct.valid_second IS NULL OR ct.valid_second = 0
                 OR pt.valid_second IS NULL OR pt.valid_second = 0 THEN NULL
               ELSE ((COALESCE(sc.votes, 0) * 100.0 / ct.valid_second) - (sp.votes * 100.0 / pt.valid_second))
             END
         END AS diff_percent_pts,
         ct.valid_first,
         ct.valid_second,
         (COALESCE(ct.valid_first, 0) + COALESCE(ct.invalid_first, 0)) AS total_voters
       FROM selected_current sc
       JOIN constituencies c ON c.id = sc.constituency_id
       JOIN states s ON s.id = c.state_id
       JOIN current_totals ct ON ct.constituency_id = sc.constituency_id
       LEFT JOIN selected_prev sp
         ON sp.constituency_id = sc.constituency_id
        AND sp.vote_type = sc.vote_type
       LEFT JOIN prev_totals pt ON pt.constituency_id = sc.constituency_id
       WHERE sc.vote_type = $2
       ORDER BY c.number`,
      [year, voteType, parties.map((p) => p.toUpperCase())]
    );

    const data = result.rows.map((row) => {
      const validVotes = voteType === 1 ? Number(row.valid_first) : Number(row.valid_second);
      const votes = Number(row.votes) || 0;
      const percent = validVotes > 0 ? (votes * 100.0) / validVotes : 0;
      return {
        constituency_number: Number(row.constituency_number),
        constituency_name: row.constituency_name,
        state_name: row.state_name,
        total_voters: Number(row.total_voters) || 0,
        votes,
        percent,
        diff_percent_pts: row.diff_percent_pts !== null ? Number(row.diff_percent_pts) : null,
      };
    });

    res.json({ data });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'db_error' });
  }
});

// Structural data for constituency analysis overlays
app.get('/api/structural-data', async (req, res) => {
  const year = req.query.year ? Number(req.query.year) : 2025;
  try {
    const metricsRes = await pool.query(
      `SELECT key, label, unit
       FROM structural_metrics
       ORDER BY label`
    );

    const dataRes = await pool.query(
      `SELECT
         c.number AS constituency_number,
         c.name AS constituency_name,
         csd.metric_key,
         csd.value
       FROM constituency_structural_data csd
       JOIN constituencies c ON c.id = csd.constituency_id
       WHERE csd.year = $1
       ORDER BY c.number`,
      [year]
    );

    const valuesMap = new Map<number, { constituency_number: number; constituency_name: string; metrics: Record<string, number | null> }>();
    for (const row of dataRes.rows) {
      if (!valuesMap.has(row.constituency_number)) {
        valuesMap.set(row.constituency_number, {
          constituency_number: row.constituency_number,
          constituency_name: row.constituency_name,
          metrics: {},
        });
      }
      valuesMap.get(row.constituency_number)!.metrics[row.metric_key] = row.value !== null ? Number(row.value) : null;
    }

    res.json({
      metrics: metricsRes.rows,
      values: Array.from(valuesMap.values()),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'db_error' });
  }
});

// Party list for analysis selectors
app.get('/api/parties', async (req, res) => {
  const year = req.query.year ? Number(req.query.year) : 2025;
  try {
    const result = await pool.query(
      `SELECT DISTINCT p.short_name, p.long_name
       FROM mv_01_constituency_party_votes cpv
       JOIN parties p ON p.id = cpv.party_id
       WHERE cpv.year = $1
       ORDER BY p.short_name`,
      [year]
    );
    res.json({ data: result.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'db_error' });
  }
});

const port = process.env.PORT ? Number(process.env.PORT) : 4000;
app.listen(port, () => console.log(`Backend running at http://localhost:${port}`));
