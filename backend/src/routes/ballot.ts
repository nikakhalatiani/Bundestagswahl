/**
 * Ballot submission routes - for casting first and second votes.
 * Uses base tables directly to work before materialized views are refreshed.
 */
import { Router } from 'express';
import dbModule from '../db';
const { pool } = dbModule;

const router = Router();

/**
 * Helper: Resolve constituency election for a given year + constituency.
 * Returns { bridge_id, year, constituency_id, number, name, state_id, state_name } or null.
 */
async function resolveConstituencyElectionByNumber(number: number, year: number) {
    const res = await pool.query(
        `SELECT ce.bridge_id, ce.year, c.id AS constituency_id, c.number, c.name, c.state_id, s.name AS state_name
         FROM constituency_elections ce
         JOIN constituencies c ON c.id = ce.constituency_id
         JOIN states s ON s.id = c.state_id
         WHERE c.number = $1 AND ce.year = $2
         LIMIT 1`,
        [number, year]
    );
    return res.rows[0] || null;
}

async function resolveConstituencyElectionById(id: number, year: number) {
    const res = await pool.query(
        `SELECT ce.bridge_id, ce.year, c.id AS constituency_id, c.number, c.name, c.state_id, s.name AS state_name
         FROM constituency_elections ce
         JOIN constituencies c ON c.id = ce.constituency_id
         JOIN states s ON s.id = c.state_id
         WHERE c.id = $1 AND ce.year = $2
         LIMIT 1`,
        [id, year]
    );
    return res.rows[0] || null;
}

async function resolveConstituencyElectionByBridgeId(bridgeId: number) {
    const res = await pool.query(
        `SELECT ce.bridge_id, ce.year, c.id AS constituency_id, c.number, c.name, c.state_id, s.name AS state_name
         FROM constituency_elections ce
         JOIN constituencies c ON c.id = ce.constituency_id
         JOIN states s ON s.id = c.state_id
         WHERE ce.bridge_id = $1
         LIMIT 1`,
        [bridgeId]
    );
    return res.rows[0] || null;
}

/**
 * Helper: Resolve constituency by number + year for ballot lookups.
 */
async function resolveConstituency(number: number, year: number) {
    const res = await pool.query(
        `SELECT c.id, c.state_id, c.number, c.name
         FROM constituencies c
         JOIN constituency_elections ce ON ce.constituency_id = c.id
         WHERE c.number = $1 AND ce.year = $2
         LIMIT 1`,
        [number, year]
    );
    return res.rows[0] || null;
}

/**
 * POST /api/ballot - Submit a ballot (erst + zweit vote)
 */
// POST: submit a ballot (erst + zweit)
router.post('/ballot', async (req, res) => {
    const body = req.body || {};
    const providedConstituencyNumber = body.constituencyNumber ? Number(body.constituencyNumber) : undefined;
    const providedConstituencyId = body.constituencyId ? Number(body.constituencyId) : undefined;
    const providedYear = body.year ? Number(body.year) : undefined;
    const votingCode = body.votingCode as string | undefined;

    try {
        // Validate voting code
        if (!votingCode || typeof votingCode !== 'string' || votingCode.trim() === '') {
            return res.status(400).json({ error: 'voting_code_required' });
        }

        // Check if voting code exists and is not used
        const codeRes = await pool.query(
            `SELECT
                vc.code,
                vc.is_used,
                vc.constituency_election_id,
                ce.year,
                c.id AS constituency_id,
                c.number AS constituency_number,
                c.name AS constituency_name,
                c.state_id,
                s.name AS state_name
             FROM voting_codes vc
             JOIN constituency_elections ce ON ce.bridge_id = vc.constituency_election_id
             JOIN constituencies c ON c.id = ce.constituency_id
             JOIN states s ON s.id = c.state_id
             WHERE vc.code = $1`,
            [votingCode.trim()]
        );
        if (!codeRes.rows || codeRes.rows.length === 0) {
            return res.status(400).json({ error: 'invalid_voting_code' });
        }
        if (codeRes.rows[0].is_used) {
            return res.status(400).json({ error: 'voting_code_already_used' });
        }
        if (!codeRes.rows[0].constituency_election_id) {
            return res.status(400).json({ error: 'voting_code_missing_context' });
        }

        const codeYear = Number(codeRes.rows[0].year);
        const codeConstituencyId = Number(codeRes.rows[0].constituency_id);
        const codeConstituencyNumber = Number(codeRes.rows[0].constituency_number);

        if (providedYear && providedYear !== codeYear) {
            return res.status(400).json({ error: 'voting_code_year_mismatch' });
        }
        if (providedConstituencyId && providedConstituencyId !== codeConstituencyId) {
            return res.status(400).json({ error: 'voting_code_constituency_mismatch' });
        }
        if (providedConstituencyNumber && providedConstituencyNumber !== codeConstituencyNumber) {
            return res.status(400).json({ error: 'voting_code_constituency_mismatch' });
        }

        const year = codeYear;
        const constituencyId = codeConstituencyId;
        const stateId = Number(codeRes.rows[0].state_id);

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

        // Mark voting code as used
        await pool.query(
            `UPDATE voting_codes SET is_used = true WHERE code = $1`,
            [votingCode.trim()]
        );

        res.json({ status: 'ok' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'db_error' });
    }
});

// POST: generate a new voting code scoped to constituency + year
router.post('/codes/generate', async (req, res) => {
    const { year, constituencyId, constituencyNumber, constituencyElectionId } = req.body || {};
    const yearNum = year ? Number(year) : NaN;

    try {
        let constituencyElection = null;
        if (constituencyElectionId) {
            constituencyElection = await resolveConstituencyElectionByBridgeId(Number(constituencyElectionId));
        } else {
            if (!year || Number.isNaN(yearNum)) {
                return res.status(400).json({ error: 'year_required' });
            }
            if (constituencyId) {
                constituencyElection = await resolveConstituencyElectionById(Number(constituencyId), yearNum);
            } else if (constituencyNumber) {
                constituencyElection = await resolveConstituencyElectionByNumber(Number(constituencyNumber), yearNum);
            } else {
                return res.status(400).json({ error: 'constituency_required' });
            }
        }

        if (!constituencyElection) {
            return res.status(404).json({ error: 'constituency_not_found' });
        }

        // Generate a random 16-character alphanumeric code
        const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
        let code = '';
        for (let i = 0; i < 16; i++) {
            code += chars.charAt(Math.floor(Math.random() * chars.length));
        }

        await pool.query(
            `INSERT INTO voting_codes (code, is_used, constituency_election_id) VALUES ($1, false, $2)`,
            [code, constituencyElection.bridge_id]
        );

        res.json({
            code,
            year: constituencyElection.year,
            constituency: {
                id: constituencyElection.constituency_id,
                number: constituencyElection.number,
                name: constituencyElection.name,
                state_name: constituencyElection.state_name,
            },
            constituency_election_id: constituencyElection.bridge_id,
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'code_generation_failed' });
    }
});

// POST: validate a voting code (check if it exists and is unused)
router.post('/codes/validate', async (req, res) => {
    const { code } = req.body || {};

    if (!code || typeof code !== 'string' || code.trim() === '') {
        return res.status(400).json({ valid: false, error: 'code_required' });
    }

    try {
        const result = await pool.query(
            `SELECT code, is_used, constituency_election_id FROM voting_codes WHERE code = $1`,
            [code.trim()]
        );

        if (!result.rows || result.rows.length === 0) {
            return res.json({ valid: false, error: 'invalid_code' });
        }

        if (result.rows[0].is_used) {
            return res.json({ valid: false, error: 'code_already_used' });
        }

        if (!result.rows[0].constituency_election_id) {
            return res.json({ valid: false, error: 'code_missing_context' });
        }

        const constituencyElection = await resolveConstituencyElectionByBridgeId(Number(result.rows[0].constituency_election_id));
        if (!constituencyElection) {
            return res.json({ valid: false, error: 'invalid_code_context' });
        }

        res.json({
            valid: true,
            year: constituencyElection.year,
            constituency: {
                id: constituencyElection.constituency_id,
                number: constituencyElection.number,
                name: constituencyElection.name,
                state_name: constituencyElection.state_name,
            },
            constituency_election_id: constituencyElection.bridge_id,
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ valid: false, error: 'validation_failed' });
    }
});

/**
 * GET /api/constituency/:number/parties - Get all parties available for second vote in a constituency.
 * Uses constituency number + year to find the correct constituency.
 */
router.get('/constituency/:number/parties', async (req, res) => {
    const constituencyNumber = Number(req.params.number);
    const year = req.query.year ? Number(req.query.year) : 2025;

    try {
        // Resolve constituency number to ID for this year
        const constituency = await resolveConstituency(constituencyNumber, year);
        if (!constituency) {
            return res.status(404).json({ error: 'constituency_not_found' });
        }

        // Use base tables to show ALL parties with party lists in the constituency's state
        const result = await pool.query(
            `SELECT DISTINCT p.id, p.short_name, p.long_name
       FROM party_lists pl
       JOIN parties p ON p.id = pl.party_id
       WHERE pl.state_id = $1 AND pl.year = $2
       ORDER BY p.short_name`,
            [constituency.state_id, year]
        );

        res.json({ data: result.rows });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'db_error' });
    }
});

/**
 * GET /api/constituency/:number/candidates - Get all direct candidates for first vote in a constituency.
 * Uses constituency number + year to find the correct constituency.
 */
router.get('/constituency/:number/candidates', async (req, res) => {
    const constituencyNumber = Number(req.params.number);
    const year = req.query.year ? Number(req.query.year) : 2025;

    try {
        // Resolve constituency number to ID for this year
        const constituency = await resolveConstituency(constituencyNumber, year);
        if (!constituency) {
            return res.status(404).json({ error: 'constituency_not_found' });
        }

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
            [constituency.id, year]
        );

        res.json({ data: result.rows });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'db_error' });
    }
});

export default router;
