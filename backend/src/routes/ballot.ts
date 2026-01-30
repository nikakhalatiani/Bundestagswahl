/**
 * Ballot submission routes - for casting first and second votes.
 * Uses base tables directly to work before materialized views are refreshed.
 */
import { Router } from 'express';
import dbModule from '../db';
const { pool } = dbModule;

const router = Router();

/**
 * POST /api/ballot - Submit a ballot (erst + zweit vote)
 */
router.post('/ballot', async (req, res) => {
    const body = req.body || {};
    const constituencyId = Number(body.constituencyId || 1);
    const year = body.year ? Number(body.year) : 2025;

    try {
        // Find constituency and state
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
            // Ensure the direct_candidacy exists for that person/year/constituency
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
            // Invalid first vote: pick any direct_candidacy person for constituency/year to satisfy FK
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
            // Find party_list for that party in this state+year
            let plRes = await pool.query(
                `SELECT id FROM party_lists WHERE party_id = $1 AND state_id = $2 AND year = $3 LIMIT 1`,
                [body.second.party_id, stateId, year]
            );
            // Fallback: any party_list for that party+year
            if (!plRes.rows || plRes.rows.length === 0) {
                plRes = await pool.query(
                    `SELECT id FROM party_lists WHERE party_id = $1 AND year = $2 LIMIT 1`,
                    [body.second.party_id, year]
                );
            }
            if (!plRes.rows || plRes.rows.length === 0) {
                return res.status(400).json({ error: 'party_list_not_found' });
            }
            partyListId = plRes.rows[0].id;
            secondIsValid = true;
        } else {
            // Invalid second: pick any party_list for the constituency state + year
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

/**
 * GET /api/constituency/:id/parties - Get all parties available for second vote in a constituency.
 * Uses base tables to work before materialized views are refreshed.
 */
router.get('/constituency/:id/parties', async (req, res) => {
    const constituencyId = Number(req.params.id);
    const year = req.query.year ? Number(req.query.year) : 2025;

    try {
        // Use base tables to show ALL parties with party lists in the constituency's state
        const result = await pool.query(
            `SELECT DISTINCT p.id, p.short_name, p.long_name
       FROM party_lists pl
       JOIN parties p ON p.id = pl.party_id
       JOIN constituencies c ON c.state_id = pl.state_id
       WHERE c.id = $1 AND pl.year = $2
       ORDER BY p.short_name`,
            [constituencyId, year]
        );

        res.json({ data: result.rows });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'db_error' });
    }
});

/**
 * GET /api/constituency/:id/candidates - Get all direct candidates for first vote in a constituency.
 * Uses base tables to work before materialized views are refreshed.
 */
router.get('/constituency/:id/candidates', async (req, res) => {
    const constituencyId = Number(req.params.id);
    const year = req.query.year ? Number(req.query.year) : 2025;

    try {
        // Simple query without slow lateral joins - vote counts not needed for ballot display
        const result = await pool.query(
            `SELECT
               per.id AS person_id,
               per.title,
               per.first_name,
               per.last_name,
               dc.party_id,
               p.short_name,
               p.long_name
             FROM direct_candidacy dc
             JOIN persons per ON per.id = dc.person_id
             JOIN parties p ON p.id = dc.party_id
             WHERE dc.constituency_id = $1 AND dc.year = $2
             ORDER BY p.short_name, per.last_name, per.first_name`,
            [constituencyId, year]
        );

        res.json({ data: result.rows });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'db_error' });
    }
});

export default router;
