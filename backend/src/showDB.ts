import dbModule from "./db";
const { pool, disconnect } = dbModule;

async function listTableSnapshot() {
  // --- Column counts
  const columnsSql = `
    SELECT table_name, COUNT(*) AS column_count
    FROM information_schema.columns
    WHERE table_schema = 'public'
    GROUP BY table_name;
  `;
  const colsRes = await pool.query(columnsSql);
  const cols: Record<string, number> = {};
  for (const r of colsRes.rows) cols[r.table_name] = Number(r.column_count);

  // --- Exact row counts
  const tableListSql = `
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
    ORDER BY table_name;
  `;
  const tablesRes = await pool.query(tableListSql);
  const rowCounts: Record<string, number> = {};

  for (const t of tablesRes.rows) {
    const name = t.table_name;
    const countRes = await pool.query(`SELECT COUNT(*)::bigint AS cnt FROM "${name}"`);
    rowCounts[name] = Number(countRes.rows[0].cnt);
  }

  // --- Primary keys
  const pkSql = `
    SELECT kcu.table_name, STRING_AGG(kcu.column_name, ', ') AS pk_columns
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON tc.constraint_name = kcu.constraint_name
     AND tc.table_name = kcu.table_name
    WHERE constraint_type = 'PRIMARY KEY' AND tc.table_schema='public'
    GROUP BY kcu.table_name;
  `;
  const pkRes = await pool.query(pkSql);
  const pks: Record<string, string> = {};
  for (const r of pkRes.rows) pks[r.table_name] = r.pk_columns;

  // --- Foreign keys
  const fkSql = `
    SELECT conrelid::regclass AS table_name,
           COUNT(*) AS fk_count
    FROM pg_constraint
    WHERE contype = 'f'
    GROUP BY conrelid;
  `;
  const fkRes = await pool.query(fkSql);
  const fks: Record<string, number> = {};
  for (const r of fkRes.rows) {
    // conrelid::regclass might return "public.tablename" or just "tablename"
    // We strip quotes and schema to match the other keys if necessary, 
    // though usually standard tables return the simple name here.
    const name = String(r.table_name).replace(/^public\./, '').replace(/"/g, '');
    fks[name] = Number(r.fk_count);
  }

  // --- Index counts (NEW)
  const idxSql = `
    SELECT tablename, COUNT(*) AS index_count
    FROM pg_indexes
    WHERE schemaname = 'public'
    GROUP BY tablename;
  `;
  const idxRes = await pool.query(idxSql);
  const idxs: Record<string, number> = {};
  for (const r of idxRes.rows) idxs[r.tablename] = Number(r.index_count);

  // --- Merge everything
  const tableNames = Array.from(
    new Set([
      ...Object.keys(cols),
      ...Object.keys(rowCounts),
      ...Object.keys(pks),
      ...Object.keys(fks),
      ...Object.keys(idxs),
    ])
  ).sort();

  const summary = tableNames.map((t) => ({
    table_name: t,
    column_count: cols[t] ?? 0,
    row_count: rowCounts[t] ?? 0,
    pk_columns: pks[t] ?? "-",
    fk_count: fks[t] ?? 0,
    index_count: idxs[t] ?? 0, // <--- New Column
  }));

  console.log("\n=== DATABASE SNAPSHOT (Exact Row Counts) ===");
  console.table(summary);
}

(async () => {
  try {
    await listTableSnapshot();
  } finally {
    await disconnect();
  }
})();