/**
 * Main Express server entry point.
 * Routes are organized into separate modules for maintainability.
 */
import express from "express";
import dbModule from "./db";
const { pool } = dbModule;

// Route modules
import ballotRoutes from "./routes/ballot";
import constituencyRoutes from "./routes/constituencies";
import seatsRoutes from "./routes/seats";
import analysisRoutes from "./routes/analysis";
import referenceRoutes from "./routes/reference";

const app = express();
app.use(express.json());

// Health check
app.get("/api/health", async (_req, res) => {
  try {
    await pool.query("SELECT 1");
    res.json({ status: "ok" });
  } catch {
    res.status(500).json({ status: "db_error" });
  }
});

// Mount route modules
app.use("/api", ballotRoutes);
app.use("/api", constituencyRoutes);
app.use("/api", seatsRoutes);
app.use("/api", analysisRoutes);
app.use("/api", referenceRoutes);

const port = process.env.PORT ? Number(process.env.PORT) : 4000;
app.listen(port, () => console.log(`Backend running at http://localhost:${port}`));
