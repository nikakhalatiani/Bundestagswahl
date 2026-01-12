import express from "express";
import dbModule from "./db";
const { pool } = dbModule;

// helper modules
// calculateSeats is CommonJS-exported
const calculateSeats = require("./calculateSeats");
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
        COALESCE(dc.previously_elected, plc.previously_elected, false) as previously_elected
      FROM seat_allocation_cache sac
      JOIN persons p ON p.id = sac.person_id
      JOIN parties pt ON pt.id = sac.party_id
      JOIN states s ON s.id = sac.state_id
      LEFT JOIN direct_candidacy dc ON dc.person_id = sac.person_id AND dc.year = sac.year
      LEFT JOIN party_lists pl ON pl.party_id = sac.party_id AND pl.state_id = sac.state_id AND pl.year = sac.year
      LEFT JOIN party_list_candidacy plc ON plc.person_id = sac.person_id AND plc.party_list_id = pl.id
      LEFT JOIN LATERAL (
        SELECT
          c2.name AS constituency_name
        FROM constituency_elections ce2
        JOIN constituency_party_votes cpv2 ON cpv2.bridge_id = ce2.bridge_id
        JOIN constituencies c2 ON c2.id = ce2.constituency_id
        WHERE
          ce2.year = $1
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
      `SELECT p.id, p.short_name, p.long_name, cp.votes, cp.vote_type
       FROM constituency_elections ce
       JOIN constituency_party_votes cp ON ce.bridge_id = cp.bridge_id
       JOIN parties p ON cp.party_id = p.id
       WHERE ce.constituency_id = $1 AND ce.year = $2 AND cp.vote_type = 2
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
      `SELECT per.id AS person_id, per.title, per.first_name, per.last_name, dc.party_id, p.short_name, p.long_name, dc.first_votes, dc.previously_elected
       FROM direct_candidacy dc
       JOIN persons per ON per.id = dc.person_id
       JOIN parties p ON p.id = dc.party_id
       WHERE dc.constituency_id = $1 AND dc.year = $2
       ORDER BY dc.first_votes DESC NULLS LAST, per.last_name, per.first_name`,
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
      `SELECT eligible_voters, total_voters, percent as turnout_percent,
              invalid_first, invalid_second, valid_first, valid_second
       FROM constituency_elections
       WHERE constituency_id = $1 AND year = $2`,
      [constituencyId, year]
    );

    // 3. Winner info with seat status from cache
    const winnerRes = await pool.query(
      `SELECT dc.person_id,
              p.first_name || ' ' || p.last_name AS full_name,
              pt.short_name AS party_name,
              dc.first_votes,
              (dc.first_votes * 100.0 / ce.valid_first) AS percent_of_valid,
              sac.seat_type
       FROM direct_candidacy dc
       JOIN persons p ON p.id = dc.person_id
       JOIN parties pt ON pt.id = dc.party_id
       JOIN constituency_elections ce ON ce.constituency_id = dc.constituency_id AND ce.year = dc.year
       LEFT JOIN seat_allocation_cache sac ON sac.person_id = dc.person_id AND sac.year = dc.year
       WHERE dc.constituency_id = $1 AND dc.year = $2
       ORDER BY dc.first_votes DESC
       LIMIT 1`,
      [constituencyId, year]
    );

    // 4. Vote distribution by party (including diff_percent_pts from 2021)
    const voteDistRes = await pool.query(
      `SELECT p.short_name AS party_name,
              COALESCE(cpv1.votes, 0) AS first_votes,
              COALESCE((cpv1.votes * 100.0 / NULLIF(ce.valid_first, 0)), 0) AS first_percent,
              COALESCE(cpv2.votes, 0) AS second_votes,
              COALESCE((cpv2.votes * 100.0 / NULLIF(ce.valid_second, 0)), 0) AS second_percent,
              cpv1.diff_percent_pts AS first_diff_pts,
              cpv2.diff_percent_pts AS second_diff_pts
       FROM constituency_elections ce
       CROSS JOIN parties p
       LEFT JOIN constituency_party_votes cpv1 ON cpv1.bridge_id = ce.bridge_id
         AND cpv1.party_id = p.id AND cpv1.vote_type = 1
       LEFT JOIN constituency_party_votes cpv2 ON cpv2.bridge_id = ce.bridge_id
         AND cpv2.party_id = p.id AND cpv2.vote_type = 2
       WHERE ce.constituency_id = $1 AND ce.year = $2
         AND (cpv1.votes IS NOT NULL OR cpv2.votes IS NOT NULL)
       ORDER BY cpv2.votes DESC NULLS LAST`,
      [constituencyId, year]
    );

    // 5. Comparison to 2021 (if available) - match by number first, then by name
    let comparison = null;
    if (year === 2025) {
      const currentConstituency = constRes.rows[0];

      // Try to find matching 2021 constituency by number first, then by name similarity
      const prevRes = await pool.query(
        `WITH matching_2021_constituency AS (
           -- First try exact number match
           SELECT c2021.id as constituency_id, 1 as match_priority
           FROM constituencies c2021
           JOIN constituency_elections ce2021 ON ce2021.constituency_id = c2021.id AND ce2021.year = 2021
           WHERE c2021.number = $1
           UNION ALL
           -- Then try name match (ignoring minor differences)
           SELECT c2021.id as constituency_id, 2 as match_priority
           FROM constituencies c2021
           JOIN constituency_elections ce2021 ON ce2021.constituency_id = c2021.id AND ce2021.year = 2021
           WHERE c2021.name = $2
             AND NOT EXISTS (
               SELECT 1 FROM constituencies cx
               JOIN constituency_elections cex ON cex.constituency_id = cx.id AND cex.year = 2021
               WHERE cx.number = $1
             )
           ORDER BY match_priority
           LIMIT 1
         )
         SELECT ce2021.percent as turnout_percent,
                dc2021.person_id,
                p2021.first_name || ' ' || p2021.last_name AS winner_2021,
                c2021.name AS matched_constituency_name
         FROM matching_2021_constituency m
         JOIN constituencies c2021 ON c2021.id = m.constituency_id
         JOIN constituency_elections ce2021 ON ce2021.constituency_id = c2021.id AND ce2021.year = 2021
         JOIN direct_candidacy dc2021 ON dc2021.constituency_id = ce2021.constituency_id
           AND dc2021.year = 2021
         JOIN persons p2021 ON p2021.id = dc2021.person_id
         ORDER BY dc2021.first_votes DESC
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
           dc.constituency_id,
           dc.person_id,
           dc.party_id,
           dc.first_votes,
           ROW_NUMBER() OVER (PARTITION BY dc.constituency_id ORDER BY dc.first_votes DESC, dc.person_id ASC) AS rank
         FROM direct_candidacy dc
         WHERE dc.year = $1
       )
       SELECT
         s.name AS state_name,
         c.number AS constituency_number,
         c.name AS constituency_name,
         p.first_name || ' ' || p.last_name AS winner_name,
         pt.short_name AS party_name,
         cw.first_votes,
         (cw.first_votes * 100.0 / ce.valid_first) AS percent_of_valid,
         CASE WHEN sac.id IS NOT NULL THEN true ELSE false END AS got_seat
       FROM ConstituencyWinners cw
       JOIN constituencies c ON c.id = cw.constituency_id
       JOIN states s ON s.id = c.state_id
       JOIN persons p ON p.id = cw.person_id
       JOIN parties pt ON pt.id = cw.party_id
       JOIN constituency_elections ce ON ce.constituency_id = cw.constituency_id AND ce.year = $1
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
           dc.constituency_id,
           dc.person_id,
           dc.party_id,
           dc.first_votes,
           ROW_NUMBER() OVER (PARTITION BY dc.constituency_id ORDER BY dc.first_votes DESC) AS rank
         FROM direct_candidacy dc
         WHERE dc.year = $1 AND dc.first_votes IS NOT NULL AND dc.first_votes > 0
       )
       SELECT
         c.number AS constituency_number,
         c.name AS constituency_name,
         p.first_name || ' ' || p.last_name AS winner_name,
         pt.short_name AS party_name,
         s.name AS state_name,
         cw.first_votes,
         (cw.first_votes * 100.0 / ce.valid_first) AS percent_first_votes,
         COALESCE(cpv2.votes, 0) AS party_second_votes,
         COALESCE((cpv2.votes * 100.0 / NULLIF(ce.valid_second, 0)), 0) AS party_second_percent
       FROM ConstituencyWinners cw
       JOIN constituencies c ON c.id = cw.constituency_id
       JOIN states s ON s.id = c.state_id
       JOIN persons p ON p.id = cw.person_id
       JOIN parties pt ON pt.id = cw.party_id
       JOIN constituency_elections ce ON ce.constituency_id = cw.constituency_id AND ce.year = $1
       LEFT JOIN constituency_party_votes cpv2 ON cpv2.bridge_id = ce.bridge_id
         AND cpv2.party_id = cw.party_id AND cpv2.vote_type = 2
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
           dc.person_id,
           dc.party_id,
           dc.first_votes,
           ROW_NUMBER() OVER (PARTITION BY dc.constituency_id ORDER BY dc.first_votes DESC, dc.person_id ASC) AS rank
         FROM direct_candidacy dc
         JOIN constituencies c ON c.id = dc.constituency_id
         JOIN states s ON s.id = c.state_id
         WHERE dc.year = $1 AND dc.first_votes IS NOT NULL AND dc.first_votes > 0
       ),
       Winners AS (SELECT * FROM RankedCandidates WHERE rank = 1),
       -- Parties that have zero constituency wins
       PartiesWithoutWins AS (
         SELECT DISTINCT dc.party_id
         FROM direct_candidacy dc
         WHERE dc.year = $1 AND dc.first_votes IS NOT NULL
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
           ((w.first_votes - rc.first_votes) * 100.0 / ce.valid_first) AS margin_percent
         FROM RankedCandidates rc
         JOIN PartiesWithoutWins pww ON pww.party_id = rc.party_id
         JOIN Winners w ON w.constituency_id = rc.constituency_id
         JOIN constituency_elections ce ON ce.constituency_id = rc.constituency_id AND ce.year = $1
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
           dc.person_id,
           dc.party_id,
           dc.first_votes,
           ROW_NUMBER() OVER (PARTITION BY dc.constituency_id ORDER BY dc.first_votes DESC, dc.person_id ASC) AS rank
         FROM direct_candidacy dc
         JOIN constituencies c ON c.id = dc.constituency_id
         JOIN states s ON s.id = c.state_id
         WHERE dc.year = $1 AND dc.first_votes IS NOT NULL AND dc.first_votes > 0
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
         ((w.first_votes - r.first_votes) * 100.0 / ce.valid_first) AS margin_percent
       FROM Winners w
       JOIN RunnersUp r ON r.constituency_id = w.constituency_id
       JOIN persons wp ON wp.id = w.person_id
       JOIN persons rp ON rp.id = r.person_id
       JOIN parties wparty ON wparty.id = w.party_id
       JOIN parties rparty ON rparty.id = r.party_id
       JOIN constituency_elections ce ON ce.constituency_id = w.constituency_id AND ce.year = $1
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

    // Query second votes by state (party lists)
    // Use constituency numbers in the EXISTS subquery to match states for second votes
    const stateIdsFilter = ids ? `AND c.number = ANY($2)` : '';
    const secondVotesRes = await pool.query(
      `SELECT
         pl.state_id,
         s.name AS state_name,
         pl.party_id,
         pt.short_name AS party_name,
         COUNT(sv.id) AS vote_count
       FROM second_votes sv
       JOIN party_lists pl ON pl.id = sv.party_list_id
       JOIN parties pt ON pt.id = pl.party_id
       JOIN states s ON s.id = pl.state_id
       WHERE pl.year = $1 AND sv.is_valid = true
         AND EXISTS (
           SELECT 1 FROM constituencies c
           WHERE c.state_id = pl.state_id ${stateIdsFilter}
         )
       GROUP BY pl.state_id, s.name, pl.party_id, pt.short_name
       ORDER BY pl.state_id, vote_count DESC`,
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

    // Add second votes (by state)
    for (const row of secondVotesRes.rows) {
      // Match second votes to constituencies by state
      for (const [_, entry] of constituenciesMap) {
        if (entry.state_name === row.state_name) {
          const existingParty = entry.party_second_votes.find((p) => p.party_name === row.party_name);
          if (!existingParty) {
            entry.party_second_votes.push({
              party_name: row.party_name,
              vote_count: Number(row.vote_count),
            });
            entry.total_second_votes += Number(row.vote_count);
          }
        }
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
    const { populateCacheForYear } = await import('./services/cacheSeats');
    await populateCacheForYear(year);
    const results = await calculateSeats(year);

    res.json({
      message: 'Cache regenerated successfully',
      year,
      stats: {
        seats: results.seatAllocation.length,
        parties: results.summary.length,
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
      `INSERT INTO second_votes (party_list_id, is_valid) VALUES ($1, $2)`,
      [partyListId, secondIsValid]
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
          // Need to join with candidacy tables for previously_elected
          joins += `
            LEFT JOIN direct_candidacy dc ON dc.person_id = sac.person_id AND dc.year = sac.year
            LEFT JOIN party_lists pl ON pl.party_id = sac.party_id AND pl.state_id = sac.state_id AND pl.year = sac.year
            LEFT JOIN party_list_candidacy plc ON plc.person_id = sac.person_id AND plc.party_list_id = pl.id
          `;
          if (status === 'new') {
            conditions.push(`COALESCE(dc.previously_elected, plc.previously_elected, false) = false`);
          } else if (status === 'reelected') {
            conditions.push(`COALESCE(dc.previously_elected, plc.previously_elected, false) = true`);
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
        params.push(voteType);
        paramIdx++;

        const conditions: string[] = ['ce.year = $1', `cpv.vote_type = $2`];
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
            SUM(cpv.votes) as votes
          FROM constituency_party_votes cpv
          JOIN constituency_elections ce ON ce.bridge_id = cpv.bridge_id
          JOIN constituencies c ON c.id = ce.constituency_id
          JOIN parties p ON p.id = cpv.party_id
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

// Bulk Constituency Vote Distribution - returns top 5 parties per constituency for map coloring/tooltips
app.get('/api/constituency-votes-bulk', async (req, res) => {
  const year = req.query.year ? Number(req.query.year) : 2025;

  try {
    // Get first and second votes for all parties in all constituencies
    const result = await pool.query(
      `WITH FirstVotes AS (
         SELECT
           c.number AS constituency_number,
           pt.short_name AS party_name,
           SUM(dc.first_votes) AS first_votes
         FROM direct_candidacy dc
         JOIN constituencies c ON c.id = dc.constituency_id
         JOIN parties pt ON pt.id = dc.party_id
         WHERE dc.year = $1 AND dc.first_votes > 0
         GROUP BY c.number, pt.short_name
       ),
       SecondVotes AS (
         SELECT
           c.number AS constituency_number,
           pt.short_name AS party_name,
           cpv.votes AS second_votes
         FROM constituency_party_votes cpv
         JOIN constituency_elections ce ON ce.bridge_id = cpv.bridge_id
         JOIN constituencies c ON c.id = ce.constituency_id
         JOIN parties pt ON pt.id = cpv.party_id
         WHERE ce.year = $1 AND cpv.vote_type = 2 AND cpv.votes > 0
       ),
       ConstituencyTotals AS (
         SELECT
           c.number AS constituency_number,
           ce.valid_first,
           ce.valid_second
         FROM constituency_elections ce
         JOIN constituencies c ON c.id = ce.constituency_id
         WHERE ce.year = $1
       ),
       Combined AS (
         SELECT
           COALESCE(fv.constituency_number, sv.constituency_number) AS constituency_number,
           COALESCE(fv.party_name, sv.party_name) AS party_name,
           COALESCE(fv.first_votes, 0) AS first_votes,
           COALESCE(sv.second_votes, 0) AS second_votes
         FROM FirstVotes fv
         FULL OUTER JOIN SecondVotes sv
           ON fv.constituency_number = sv.constituency_number
           AND fv.party_name = sv.party_name
       ),
       RankedFirst AS (
         SELECT
           c.constituency_number,
           c.party_name,
           c.first_votes,
           c.second_votes,
           ct.valid_first,
           ct.valid_second,
           ROW_NUMBER() OVER (PARTITION BY c.constituency_number ORDER BY c.first_votes DESC) AS rank_first
         FROM Combined c
         JOIN ConstituencyTotals ct ON ct.constituency_number = c.constituency_number
       ),
       RankedSecond AS (
         SELECT
           c.constituency_number,
           c.party_name,
           c.first_votes,
           c.second_votes,
           ct.valid_first,
           ct.valid_second,
           ROW_NUMBER() OVER (PARTITION BY c.constituency_number ORDER BY c.second_votes DESC) AS rank_second
         FROM Combined c
         JOIN ConstituencyTotals ct ON ct.constituency_number = c.constituency_number
       )
       SELECT
         rf.constituency_number,
         rf.party_name,
         rf.first_votes,
         rf.second_votes,
         CASE WHEN rf.valid_first > 0 THEN (rf.first_votes * 100.0 / rf.valid_first) ELSE 0 END AS first_percent,
         CASE WHEN rf.valid_second > 0 THEN (rf.second_votes * 100.0 / rf.valid_second) ELSE 0 END AS second_percent,
         rf.rank_first,
         rs.rank_second
       FROM RankedFirst rf
       JOIN RankedSecond rs ON rf.constituency_number = rs.constituency_number AND rf.party_name = rs.party_name
       WHERE rf.rank_first <= 5 OR rs.rank_second <= 5
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

// Bonus Analysis 1: Disposable Income Data
app.get('/api/disposable-income', async (req, res) => {
  const year = 2025;
  try {
    const result = await pool.query(
      `WITH direct_candidate_rankings AS (
         SELECT
           dc.constituency_id,
           dc.party_id,
           ROW_NUMBER() OVER (PARTITION BY dc.constituency_id ORDER BY dc.first_votes DESC) as rn
         FROM direct_candidacy dc
         WHERE dc.year = $1
       )
       SELECT
         c.id as constituency_id,
         c.number as constituency_number,
         c.name as constituency_name,
         COALESCE(p.short_name, '') as party_name,
         CAST(c.disposable_income AS FLOAT) as disposable_income
       FROM constituencies c
       JOIN constituency_elections ce ON ce.constituency_id = c.id AND ce.year = $1
       LEFT JOIN direct_candidate_rankings r ON r.constituency_id = c.id AND r.rn = 1
       LEFT JOIN parties p ON p.id = r.party_id
       ORDER BY c.number`,
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
