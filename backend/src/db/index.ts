import "dotenv/config";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

// Shared connection pool
export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 20,               // allow concurrent queries
  idleTimeoutMillis: 0,  // keep connections alive (for long imports)
});

export const db = drizzle(pool, { schema });

export async function disconnect() {
  await pool.end();
  console.log("Database pool closed.");
}

// default export for convenience
export default { pool, db, disconnect };