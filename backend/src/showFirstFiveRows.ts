import dbModule from "./db";
const { pool, disconnect } = dbModule;

async function main() {
  console.log("=== DATABASE CONTENT PREVIEW ===\n");

  // Table list + their primary key columns
  const TABLES: { name: string; pk: string }[] = [
    { name: "states", pk: "id" },
    { name: "parties", pk: "id" },
    { name: "elections", pk: "year" },
    { name: "constituencies", pk: "id" },
    { name: "persons", pk: "id" },
    { name: "party_lists", pk: "id" },
    { name: "direct_candidacy", pk: "person_id, year" },
    { name: "party_list_candidacy", pk: "person_id, party_list_id" },
    { name: "constituency_elections", pk: "bridge_id" },
    { name: "constituency_party_votes", pk: "id" },
  ];

  for (const { name, pk } of TABLES) {
    console.log(`\n=== ${name.toUpperCase()} ===`);
    const countRes = await pool.query(`SELECT COUNT(*)::int AS cnt FROM ${name}`);
    const count = countRes.rows[0].cnt;
    console.log(`Total rows: ${count}`);

    if (count === 0) {
      console.log("  (empty)");
      continue;
    }

    // --- show first 5 rows ordered by PK ---
    const orderBy = pk.includes(",")
      ? pk
          .split(",")
          .map((x) => x.trim())
          .join(", ")
      : pk;
    const rows = await pool.query(`SELECT * FROM ${name} ORDER BY ${orderBy} LIMIT 5`);

    if (rows.rows.length === 0) {
      console.log("  (no rows fetched)");
    } else {
      // print header once
      const headers = Object.keys(rows.rows[0]);
      console.log(headers.join(" | "));
      for (const r of rows.rows) {
        const line = headers.map((h) => String(r[h] ?? "")).join(" | ");
        console.log(line);
      }
    }
  }
}

main()
  .catch((err) => console.error("❌ Error showing rows:", err))
  .finally(async () => {
    await disconnect();
    console.log("\nDatabase connection closed.");
  });