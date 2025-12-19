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

const port = process.env.PORT ? Number(process.env.PORT) : 4000;
app.listen(port, () => console.log(`Backend running at http://localhost:${port}`));
