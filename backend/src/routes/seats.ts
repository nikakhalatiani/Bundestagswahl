/**
 * Seat allocation and member-related routes.
 */
import { Router } from 'express';
import dbModule from '../db';
import { ensureCacheMiddleware, refreshSeatCaches } from '../services/cacheSeats';
const { pool } = dbModule;

const router = Router();

/**
 * GET /api/seats - Seat distribution by party (Q1).
 */
router.get('/seats', ensureCacheMiddleware, async (req, res) => {
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

/**
 * GET /api/members - All Bundestag members (Q2).
 */
router.get('/members', ensureCacheMiddleware, async (req, res) => {
  const year = req.query.year ? Number(req.query.year) : 2025;

  try {
    // Pre-compute previous year once
    const prevYearRes = await pool.query(`SELECT MAX(year) AS prev_year FROM elections WHERE year < $1`, [year]);
    const prevYear = prevYearRes.rows[0]?.prev_year;

    const result = await pool.query(`
      WITH prev_members AS (
        SELECT DISTINCT person_id FROM seat_allocation_cache WHERE year = $2
      ),
      top_constituencies AS (
        SELECT DISTINCT ON (cpv.party_id, c.state_id)
          cpv.party_id, c.state_id, c.name AS constituency_name
        FROM mv_01_constituency_party_votes cpv
        JOIN constituencies c ON c.id = cpv.constituency_id
        WHERE cpv.year = $1 AND cpv.vote_type = 2
        ORDER BY cpv.party_id, c.state_id, cpv.votes DESC
      )
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
        COALESCE(sac.constituency_name, tc.constituency_name) AS constituency_name,
        sac.list_position,
        sac.percent_first_votes,
        (pm.person_id IS NOT NULL) as previously_elected
      FROM seat_allocation_cache sac
      JOIN persons p ON p.id = sac.person_id
      JOIN parties pt ON pt.id = sac.party_id
      JOIN states s ON s.id = sac.state_id
      LEFT JOIN prev_members pm ON pm.person_id = sac.person_id
      LEFT JOIN top_constituencies tc ON tc.party_id = sac.party_id AND tc.state_id = sac.state_id
      WHERE sac.year = $1
      ORDER BY pt.short_name, s.name, p.last_name, p.first_name
    `, [year, prevYear]);

    res.json({ data: result.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'db_error' });
  }
});

/**
 * GET /api/direct-without-coverage - Direct mandate winners who didn't get seats (Q5).
 */
router.get('/direct-without-coverage', ensureCacheMiddleware, async (req, res) => {
  const year = req.query.year ? Number(req.query.year) : 2025;

  try {
    const result = await pool.query(
      `WITH ConstituencyWinners AS (
         SELECT dcv.constituency_id, dcv.person_id, dcv.party_id, dcv.first_votes,
           ROW_NUMBER() OVER (PARTITION BY dcv.constituency_id ORDER BY dcv.first_votes DESC) AS rank
         FROM mv_00_direct_candidacy_votes dcv
         WHERE dcv.year = $1 AND dcv.first_votes IS NOT NULL AND dcv.first_votes > 0
       )
       SELECT
         c.number AS constituency_number, c.name AS constituency_name,
         p.first_name || ' ' || p.last_name AS winner_name,
         pt.short_name AS party_name, s.name AS state_name,
         cw.first_votes,
         (cw.first_votes * 100.0 / NULLIF(mce.valid_first, 0))::double precision AS percent_first_votes,
         COALESCE(cpv2.votes, 0) AS party_second_votes,
         COALESCE((cpv2.votes * 100.0 / NULLIF(mce.valid_second, 0))::double precision, 0) AS party_second_percent
       FROM ConstituencyWinners cw
       JOIN constituencies c ON c.id = cw.constituency_id
       JOIN states s ON s.id = c.state_id
       JOIN persons p ON p.id = cw.person_id
       JOIN parties pt ON pt.id = cw.party_id
       JOIN mv_03_constituency_elections mce ON mce.constituency_id = cw.constituency_id AND mce.year = $1
       LEFT JOIN mv_01_constituency_party_votes cpv2
         ON cpv2.constituency_id = cw.constituency_id AND cpv2.year = $1 AND cpv2.party_id = cw.party_id AND cpv2.vote_type = 2
       LEFT JOIN seat_allocation_cache sac
         ON sac.person_id = cw.person_id AND sac.year = $1 AND sac.seat_type LIKE '%Direct Mandate%'
       WHERE cw.rank = 1 AND sac.id IS NULL
       ORDER BY cw.first_votes DESC`,
      [year]
    );

    res.json({ data: result.rows, total_lost_mandates: result.rows.length });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'db_error' });
  }
});

/**
 * POST /api/admin/calculate-seats - Regenerate seat allocation cache.
 */
router.post('/admin/calculate-seats', async (req, res) => {
  const year = req.query.year ? Number(req.query.year) : 2025;

  try {
    await refreshSeatCaches();
    const statsRes = await pool.query(
      `SELECT COUNT(*)::int AS seats, COUNT(DISTINCT party_id)::int AS parties
       FROM seat_allocation_cache WHERE year = $1`,
      [year]
    );
    const statsRow = statsRes.rows[0] || { seats: 0, parties: 0 };

    res.json({
      message: 'Cache regenerated successfully',
      year,
      stats: { seats: Number(statsRow.seats) || 0, parties: Number(statsRow.parties) || 0 }
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'cache_regeneration_failed', details: String(err) });
  }
});

export default router;
