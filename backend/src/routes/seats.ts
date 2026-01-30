/**
 * Seat allocation and member-related routes.
 */
import { Router, Request, Response, NextFunction } from 'express';
import dbModule from '../db';
import { ensureCacheExists, refreshSeatCaches } from '../services/cacheSeats';
const { pool } = dbModule;

const router = Router();

// Middleware: ensure cache exists for requested year
async function ensureCache(req: Request, res: Response, next: NextFunction) {
    const year = req.query.year ? Number(req.query.year) : 2025;
    try {
        await ensureCacheExists(year);
        next();
    } catch (err) {
        console.error('Cache population failed:', err);
        res.status(500).json({ error: 'cache_error' });
    }
}

/**
 * GET /api/seats - Seat distribution by party (Q1).
 */
router.get('/seats', ensureCache, async (req, res) => {
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
router.get('/members', ensureCache, async (req, res) => {
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
        SELECT c2.name AS constituency_name
        FROM mv_01_constituency_party_votes cpv2
        JOIN constituencies c2 ON c2.id = cpv2.constituency_id
        WHERE cpv2.year = $1
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

/**
 * GET /api/direct-without-coverage - Direct mandate winners who didn't get seats (Q5).
 */
router.get('/direct-without-coverage', ensureCache, async (req, res) => {
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
