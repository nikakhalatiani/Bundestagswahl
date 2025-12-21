import express from "express";
import dbModule from "./db";
const { pool } = dbModule;

// helper modules
import listCandidates from "./listCandidates";
import countSeatsPerParty from "./countSeatsPerParty";
// calculateSeats is CommonJS-exported
const calculateSeats = require("./calculateSeats");

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

// Q1: Sitzverteilung
app.get('/api/seats', async (req, res) => {
  const year = req.query.year ? Number(req.query.year) : 2025;
  const data = await countSeatsPerParty(year);
  res.json({ data });
});

// Q2: Mitglieder des Bundestages
app.get('/api/members', async (req, res) => {
  const year = req.query.year ? Number(req.query.year) : 2025;
  const data = await calculateSeats(year);
  res.json({ data });
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
    let firstIsValid = true;
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
    let secondIsValid = true;
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

const port = process.env.PORT ? Number(process.env.PORT) : 4000;
app.listen(port, () => console.log(`Backend running at http://localhost:${port}`));
