/**
 * Analysis routes - election results, near-misses, closest winners, party strength.
 * Optimized to reduce SQL redundancy.
 */
import { Router } from 'express';
import dbModule from '../db';
import { expandPartyFilter, toInt, RANKED_CANDIDATES_CTE, CDU_CSU_CASE, expandPartyParam } from '../utils/queryHelpers';
const { pool } = dbModule;

const router = Router();

/**
 * GET /api/election-results - Aggregated election results with filters.
 */
router.get('/election-results', async (req, res) => {
    const year = req.query.year ? Number(req.query.year) : 2025;
    const type = req.query.type ? String(req.query.type) : 'second';
    const stateIds: number[] = req.query.state_ids
        ? String(req.query.state_ids).split(',').map(Number).filter(n => !isNaN(n))
        : req.query.state_id ? [Number(req.query.state_id)] : [];
    const mandateType = req.query.mandate_type ? String(req.query.mandate_type) : null;
    const gender = req.query.gender ? String(req.query.gender) : null;
    const parties: string[] = req.query.parties
        ? String(req.query.parties).split(',').filter(p => p.trim())
        : req.query.party ? [String(req.query.party)] : [];
    const status = req.query.status ? String(req.query.status) : null;

    const prevYearRes = await pool.query("SELECT MAX(year) as year FROM elections WHERE year < $1", [year]);
    const prevYear = prevYearRes.rows[0]?.year ?? (year === 2025 ? 2021 : 2017);

    try {
        type ResultRow = { short_name: string; long_name: string; votes: string | number | null };

        const buildQuery = async (y: number): Promise<ResultRow[]> => {
            const params: (number | string)[] = [y];
            let idx = 2;

            // Helper to add array condition
            const addArrayCondition = (arr: (number | string)[], colExpr: string) => {
                if (arr.length === 0) return null;
                const ph = arr.map(() => `$${idx++}`).join(', ');
                params.push(...arr);
                return `${colExpr} IN (${ph})`;
            };

            if (type === 'seats') {
                const conds = ['sac.year = $1'];
                let joins = 'FROM seat_allocation_cache sac JOIN parties p ON p.id = sac.party_id JOIN persons per ON per.id = sac.person_id';

                if (stateIds.length) conds.push(addArrayCondition(stateIds, 'sac.state_id')!);
                if (mandateType) { conds.push(`sac.seat_type = $${idx++}`); params.push(mandateType === 'direct' ? 'Direct Mandate' : 'List Mandate'); }
                if (gender) { conds.push(`LOWER(per.gender) = $${idx++}`); params.push(gender.toLowerCase()); }
                if (parties.length) conds.push(addArrayCondition(expandPartyFilter(parties), 'p.short_name')!);

                if (status) {
                    const prevElectionRes = await pool.query("SELECT MAX(year) as year FROM elections WHERE year < $1", [y]);
                    const prevElectionYear = prevElectionRes.rows[0]?.year;
                    if (prevElectionYear) {
                        joins += ` LEFT JOIN seat_allocation_cache prev_sac ON prev_sac.person_id = sac.person_id AND prev_sac.year = $${idx++}`;
                        params.push(prevElectionYear);
                        conds.push(status === 'new' ? 'prev_sac.person_id IS NULL' : 'prev_sac.person_id IS NOT NULL');
                    } else if (status === 'reelected') {
                        conds.push('1 = 0');
                    }
                }

                const q = `SELECT ${CDU_CSU_CASE('p.short_name')} as short_name, ${CDU_CSU_CASE('p.long_name')} as long_name, COUNT(*) as votes ${joins} WHERE ${conds.join(' AND ')} GROUP BY 1, 2 ORDER BY votes DESC`;
                return (await pool.query<ResultRow>(q, params)).rows;
            }

            // Vote-based queries (first or second)
            if (type === 'second') {
                const conds = ['plv.year = $1'];
                if (stateIds.length) conds.push(addArrayCondition(stateIds, 'plv.state_id')!);
                if (parties.length) conds.push(addArrayCondition(expandPartyFilter(parties), 'p.short_name')!);

                const q = `SELECT ${CDU_CSU_CASE('p.short_name')} as short_name, ${CDU_CSU_CASE('p.long_name')} as long_name, SUM(plv.second_votes) as votes FROM mv_02_party_list_votes plv JOIN parties p ON p.id = plv.party_id WHERE ${conds.join(' AND ')} GROUP BY 1, 2 ORDER BY votes DESC`;
                return (await pool.query<ResultRow>(q, params)).rows;
            }

            // First votes
            const conds = ['pv.year = $1', 'pv.vote_type = 1'];
            if (stateIds.length) conds.push(addArrayCondition(stateIds, 'c.state_id')!);
            if (parties.length) conds.push(addArrayCondition(expandPartyFilter(parties), 'p.short_name')!);

            const q = `SELECT ${CDU_CSU_CASE('p.short_name')} as short_name, ${CDU_CSU_CASE('p.long_name')} as long_name, SUM(pv.votes) as votes FROM mv_01_constituency_party_votes pv JOIN constituencies c ON c.id = pv.constituency_id JOIN parties p ON p.id = pv.party_id WHERE ${conds.join(' AND ')} GROUP BY 1, 2 ORDER BY votes DESC`;
            return (await pool.query<ResultRow>(q, params)).rows;
        };

        const [currentVotes, prevVotes] = await Promise.all([buildQuery(year), buildQuery(prevYear)]);
        const totalCurrent = currentVotes.reduce((s, r) => s + toInt(r.votes), 0);
        const totalPrev = prevVotes.reduce((s, r) => s + toInt(r.votes), 0);

        const map = new Map<string, { name: string; abbr: string; votes: number; prevVotes: number }>();
        for (const r of currentVotes) map.set(r.short_name, { name: r.long_name, abbr: r.short_name, votes: toInt(r.votes), prevVotes: 0 });
        for (const r of prevVotes) {
            const e = map.get(r.short_name);
            if (e) e.prevVotes = toInt(r.votes);
            else map.set(r.short_name, { name: r.long_name, abbr: r.short_name, votes: 0, prevVotes: toInt(r.votes) });
        }

        const data = [...map.values()]
            .map(e => ({ name: e.name, abbreviation: e.abbr, votes: e.votes, percentage: totalCurrent > 0 ? e.votes / totalCurrent * 100 : 0, prevVotes: e.prevVotes, prevPercentage: totalPrev > 0 ? e.prevVotes / totalPrev * 100 : 0 }))
            .sort((a, b) => Math.max(b.votes, b.prevVotes) - Math.max(a.votes, a.prevVotes));

        res.json({ data, totalVotes: totalCurrent, prevTotalVotes: totalPrev });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'db_error' });
    }
});

/**
 * GET /api/near-misses - Near-misses for parties without constituency wins.
 */
router.get('/near-misses', async (req, res) => {
    const year = req.query.year ? Number(req.query.year) : 2025;
    const limit = req.query.limit ? Number(req.query.limit) : 10;

    try {
        const result = await pool.query(`
      WITH ${RANKED_CANDIDATES_CTE('$1')},
      PartiesWithoutWins AS (
        SELECT DISTINCT party_id FROM RankedCandidates
        EXCEPT SELECT DISTINCT party_id FROM Winners
      ),
      NearMisses AS (
        SELECT rc.*, w.first_votes AS winner_votes, (w.first_votes - rc.first_votes) AS margin_votes,
          ((w.first_votes - rc.first_votes) * 100.0 / NULLIF(mce.valid_first, 0))::double precision AS margin_percent
        FROM RankedCandidates rc
        JOIN PartiesWithoutWins pww ON pww.party_id = rc.party_id
        JOIN Winners w ON w.constituency_id = rc.constituency_id
        JOIN mv_03_constituency_elections mce ON mce.constituency_id = rc.constituency_id AND mce.year = $1
        WHERE rc.rank > 1
      )
      SELECT ROW_NUMBER() OVER (PARTITION BY nm.party_id ORDER BY nm.margin_votes) AS party_rank,
        nm.constituency_number, nm.constituency_name, nm.state_name,
        p.first_name || ' ' || p.last_name AS candidate_name, pt.short_name AS party_name,
        nm.first_votes AS candidate_votes, nm.winner_votes, nm.margin_votes, nm.margin_percent
      FROM NearMisses nm
      JOIN persons p ON p.id = nm.person_id
      JOIN parties pt ON pt.id = nm.party_id
      ORDER BY pt.short_name, nm.margin_votes`, [year]);

        const grouped: Record<string, typeof result.rows> = {};
        for (const row of result.rows) {
            if (!grouped[row.party_name]) grouped[row.party_name] = [];
            if (grouped[row.party_name].length < limit) grouped[row.party_name].push(row);
        }
        res.json({ data: grouped });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'db_error' });
    }
});

/**
 * GET /api/closest-winners - Top closest winning margins.
 */
router.get('/closest-winners', async (req, res) => {
    const year = req.query.year ? Number(req.query.year) : 2025;
    const limit = req.query.limit ? Number(req.query.limit) : 10;

    try {
        const result = await pool.query(`
      WITH ${RANKED_CANDIDATES_CTE('$1')}
      SELECT ROW_NUMBER() OVER (ORDER BY (w.first_votes - r.first_votes)) AS rank,
        w.constituency_name, w.state_name,
        wp.first_name || ' ' || wp.last_name AS winner_name, wpt.short_name AS winner_party, w.first_votes AS winner_votes,
        rp.first_name || ' ' || rp.last_name AS runner_up_name, rpt.short_name AS runner_up_party, r.first_votes AS runner_up_votes,
        (w.first_votes - r.first_votes) AS margin_votes,
        ((w.first_votes - r.first_votes) * 100.0 / NULLIF(mce.valid_first, 0))::double precision AS margin_percent
      FROM Winners w
      JOIN RunnersUp r ON r.constituency_id = w.constituency_id
      JOIN persons wp ON wp.id = w.person_id
      JOIN persons rp ON rp.id = r.person_id
      JOIN parties wpt ON wpt.id = w.party_id
      JOIN parties rpt ON rpt.id = r.party_id
      JOIN mv_03_constituency_elections mce ON mce.constituency_id = w.constituency_id AND mce.year = $1
      ORDER BY margin_votes LIMIT $2`, [year, limit]);
        res.json({ data: result.rows });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'db_error' });
    }
});

/**
 * GET /api/party-constituency-strength - Party strength per constituency for map.
 */
router.get('/party-constituency-strength', async (req, res) => {
    const year = req.query.year ? Number(req.query.year) : 2025;
    const voteType = req.query.vote_type ? Number(req.query.vote_type) : 2;
    const partyParam = typeof req.query.party === 'string' ? req.query.party.trim() : '';

    if (!partyParam) return res.status(400).json({ error: 'missing_party' });

    const parties = expandPartyParam(partyParam);

    try {
        const result = await pool.query(`
      WITH party_filter AS (SELECT id FROM parties WHERE UPPER(short_name) = ANY($3)),
      prev_year AS (SELECT MAX(year) AS year FROM elections WHERE year < $1),
      -- Normalize names for matching across years
      current_const AS (
        SELECT c.id, c.number, c.name, c.state_id,
          replace(replace(replace(lower(regexp_replace(translate(replace(c.name, 'ß', 'ss'), 'ÄÖÜäöü', 'AOUaou'), '[^A-Za-z0-9]+', '', 'g')), 'ae', 'a'), 'oe', 'o'), 'ue', 'u') AS norm_name
        FROM constituencies c
        JOIN constituency_elections ce ON ce.constituency_id = c.id AND ce.year = $1
      ),
      prev_const AS (
        SELECT c.id, c.number, c.state_id,
          replace(replace(replace(lower(regexp_replace(translate(replace(c.name, 'ß', 'ss'), 'ÄÖÜäöü', 'AOUaou'), '[^A-Za-z0-9]+', '', 'g')), 'ae', 'a'), 'oe', 'o'), 'ue', 'u') AS norm_name
        FROM constituencies c
        JOIN constituency_elections ce ON ce.constituency_id = c.id AND ce.year = (SELECT year FROM prev_year)
      ),
      -- Match current to previous by name+state, then by number+state, then by name alone
      constituency_mapping AS (
        SELECT cc.id AS current_id, cc.number, cc.name, cc.state_id,
          COALESCE(
            (SELECT pc.id FROM prev_const pc WHERE pc.norm_name = cc.norm_name AND pc.state_id = cc.state_id LIMIT 1),
            (SELECT pc.id FROM prev_const pc WHERE pc.number = cc.number AND pc.state_id = cc.state_id LIMIT 1),
            (SELECT pc.id FROM prev_const pc WHERE pc.norm_name = cc.norm_name LIMIT 1)
          ) AS prev_id
        FROM current_const cc
      ),
      current_votes AS (
        SELECT constituency_id, SUM(votes) AS votes
        FROM mv_01_constituency_party_votes cv
        JOIN party_filter pf ON pf.id = cv.party_id
        WHERE cv.year = $1 AND cv.vote_type = $2
        GROUP BY constituency_id
      ),
      current_totals AS (SELECT constituency_id, valid_first, valid_second, invalid_first FROM mv_03_constituency_elections WHERE year = $1),
      prev_votes AS (
        SELECT cv.constituency_id, SUM(cv.votes) AS votes
        FROM mv_01_constituency_party_votes cv
        JOIN party_filter pf ON pf.id = cv.party_id
        WHERE cv.year = (SELECT year FROM prev_year) AND cv.vote_type = $2
        GROUP BY cv.constituency_id
      ),
      prev_totals AS (SELECT constituency_id, valid_first, valid_second FROM mv_03_constituency_elections WHERE year = (SELECT year FROM prev_year))
      SELECT c.number AS constituency_number, c.name AS constituency_name, s.name AS state_name,
        COALESCE(cv.votes, 0) AS votes,
        CASE WHEN pv.votes IS NOT NULL AND $2 = 1 AND ct.valid_first > 0 AND pt.valid_first > 0
          THEN ((COALESCE(cv.votes, 0) * 100.0 / ct.valid_first) - (pv.votes * 100.0 / pt.valid_first))
          WHEN pv.votes IS NOT NULL AND $2 = 2 AND ct.valid_second > 0 AND pt.valid_second > 0
          THEN ((COALESCE(cv.votes, 0) * 100.0 / ct.valid_second) - (pv.votes * 100.0 / pt.valid_second))
        END AS diff_percent_pts,
        ct.valid_first, ct.valid_second, (COALESCE(ct.valid_first, 0) + COALESCE(ct.invalid_first, 0)) AS total_voters
      FROM current_votes cv
      JOIN constituencies c ON c.id = cv.constituency_id
      JOIN states s ON s.id = c.state_id
      JOIN current_totals ct ON ct.constituency_id = cv.constituency_id
      JOIN constituency_mapping cm ON cm.current_id = cv.constituency_id
      LEFT JOIN prev_votes pv ON pv.constituency_id = cm.prev_id
      LEFT JOIN prev_totals pt ON pt.constituency_id = cm.prev_id
      ORDER BY c.number`,
            [year, voteType, parties.map(p => p.toUpperCase())]
        );

        const data = result.rows.map(row => {
            const validVotes = voteType === 1 ? Number(row.valid_first) : Number(row.valid_second);
            const votes = Number(row.votes) || 0;
            return {
                constituency_number: Number(row.constituency_number),
                constituency_name: row.constituency_name,
                state_name: row.state_name,
                total_voters: Number(row.total_voters) || 0,
                votes,
                percent: validVotes > 0 ? (votes * 100.0) / validVotes : 0,
                diff_percent_pts: row.diff_percent_pts !== null ? Number(row.diff_percent_pts) : null,
            };
        });
        res.json({ data });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'db_error' });
    }
});

/**
 * GET /api/constituencies-single - Constituency overview based on individual votes.
 */
router.get('/constituencies-single', async (req, res) => {
    const idsParam = req.query.ids as string;
    const ids = idsParam ? idsParam.split(',').map(Number) : null;
    const bridgeIdsParam = req.query.constituencyElectionIds as string;
    const bridgeIds = bridgeIdsParam ? bridgeIdsParam.split(',').map(Number) : null;
    let year = req.query.year ? Number(req.query.year) : 2025;

    try {
        if (bridgeIds) {
            const yearRes = await pool.query(
                `SELECT DISTINCT year FROM constituency_elections WHERE bridge_id = ANY($1)`,
                [bridgeIds]
            );
            if (!yearRes.rows.length) {
                return res.status(404).json({ error: 'constituency_not_found' });
            }
            if (yearRes.rows.length > 1) {
                return res.status(400).json({ error: 'mixed_years_not_supported' });
            }
            year = Number(yearRes.rows[0].year);
        }

        const idsFilter = bridgeIds
            ? 'AND ce.bridge_id = ANY($2)'
            : (ids ? 'AND c.number = ANY($2)' : '');
        const params = (bridgeIds || ids) ? [year, bridgeIds ?? ids] : [year];

        // Combined query for both first and second votes
        const firstVotesRes = await pool.query(`
      SELECT ce.constituency_id, ce.bridge_id AS constituency_election_id, c.name AS constituency_name, s.name AS state_name,
        dc.person_id, p.first_name || ' ' || p.last_name AS person_name, pt.short_name AS party_name,
        COUNT(fv.id) AS vote_count, RANK() OVER (PARTITION BY ce.constituency_id ORDER BY COUNT(fv.id) DESC) AS rank
      FROM first_votes fv
      JOIN direct_candidacy dc
        ON dc.person_id = fv.direct_person_id
       AND dc.constituency_election_id = fv.constituency_election_id
      JOIN constituency_elections ce ON ce.bridge_id = fv.constituency_election_id
      JOIN persons p ON p.id = dc.person_id
      JOIN parties pt ON pt.id = dc.party_id
      JOIN constituencies c ON c.id = ce.constituency_id
      JOIN states s ON s.id = c.state_id
      WHERE ce.year = $1 AND fv.is_valid = true ${idsFilter}
      GROUP BY ce.constituency_id, ce.bridge_id, c.name, s.name, dc.person_id, p.first_name, p.last_name, pt.short_name
      ORDER BY ce.constituency_id, vote_count DESC`, params);

        const secondVotesRes = await pool.query(`
      SELECT c.id AS constituency_id, ce.bridge_id AS constituency_election_id, c.name AS constituency_name, s.name AS state_name,
        pl.party_id, pt.short_name AS party_name, COUNT(sv.id) AS vote_count
      FROM second_votes sv
      JOIN party_lists pl ON pl.id = sv.party_list_id
      JOIN parties pt ON pt.id = pl.party_id
      JOIN constituency_elections ce ON ce.bridge_id = sv.constituency_election_id
      JOIN constituencies c ON c.id = ce.constituency_id
      JOIN states s ON s.id = c.state_id
      WHERE pl.year = $1 AND ce.year = $1 AND sv.is_valid = true ${idsFilter}
      GROUP BY c.id, ce.bridge_id, c.name, s.name, pl.party_id, pt.short_name
      ORDER BY c.id, vote_count DESC`, params);

        type Entry = { constituency_id: number; constituency_election_id: number | null; constituency_name: string; state_name: string; candidates: any[]; party_second_votes: any[]; total_first_votes: number; total_second_votes: number };
        const map = new Map<number, Entry>();

        for (const r of firstVotesRes.rows) {
            if (!map.has(r.constituency_id)) map.set(r.constituency_id, { constituency_id: r.constituency_id, constituency_election_id: r.constituency_election_id ?? null, constituency_name: r.constituency_name, state_name: r.state_name, candidates: [], party_second_votes: [], total_first_votes: 0, total_second_votes: 0 });
            const e = map.get(r.constituency_id)!;
            e.candidates.push({ person_name: r.person_name, party_name: r.party_name, vote_count: Number(r.vote_count), is_winner: Number(r.rank) === 1 });
            e.total_first_votes += Number(r.vote_count);
        }

        for (const r of secondVotesRes.rows) {
            if (!map.has(r.constituency_id)) map.set(r.constituency_id, { constituency_id: r.constituency_id, constituency_election_id: r.constituency_election_id ?? null, constituency_name: r.constituency_name, state_name: r.state_name, candidates: [], party_second_votes: [], total_first_votes: 0, total_second_votes: 0 });
            const e = map.get(r.constituency_id)!;
            if (!e.party_second_votes.find(p => p.party_name === r.party_name)) {
                e.party_second_votes.push({ party_name: r.party_name, vote_count: Number(r.vote_count) });
                e.total_second_votes += Number(r.vote_count);
            }
        }

        res.json({ data: [...map.values()] });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'db_error' });
    }
});

export default router;
