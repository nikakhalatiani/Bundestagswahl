/**
 * Reference data routes - parties, structural data, states.
 */
import { Router } from 'express';
import dbModule from '../db';
const { pool } = dbModule;

const router = Router();

/**
 * GET /api/parties - List of parties for selectors.
 */
router.get('/parties', async (req, res) => {
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

/**
 * GET /api/structural-data - Structural data for constituency analysis.
 */
router.get('/structural-data', async (req, res) => {
    const year = req.query.year ? Number(req.query.year) : 2025;
    try {
        const metricsRes = await pool.query(
            `SELECT key, label, unit FROM structural_metrics ORDER BY label`
        );

        const dataRes = await pool.query(
            `SELECT c.number AS constituency_number, c.name AS constituency_name, csd.metric_key, csd.value
       FROM constituency_structural_data csd
       JOIN constituency_elections ce ON ce.bridge_id = csd.constituency_election_id
       JOIN constituencies c ON c.id = ce.constituency_id
       WHERE ce.year = $1
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

        res.json({ metrics: metricsRes.rows, values: Array.from(valuesMap.values()) });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'db_error' });
    }
});

export default router;
