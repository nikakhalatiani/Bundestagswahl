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

const port = process.env.PORT ? Number(process.env.PORT) : 4000;
app.listen(port, () => console.log(`Backend running at http://localhost:${port}`));
