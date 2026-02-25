import { readdir, readFile } from "fs/promises";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import type { PoolClient } from "pg";
import { pool } from "./client.js";

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), "migrations");

/**
 * Runs pending SQL migrations from src/db/migrations/ at startup.
 * Tracks applied migrations in the _migrations table (independent of drizzle-kit).
 * Each .sql file is applied exactly once, in alphabetical order.
 *
 * Bootstrap detection: if the tracking table is empty but the DB already has
 * schema (created manually before this runner existed), auto-seeds the history
 * by inspecting what's already present in the DB.
 */
export async function runMigrations(): Promise<void> {
  const client = await pool.connect();
  try {
    // Create tracking table if it doesn't exist
    const { rowCount: tableCreated } = await client.query(`
      CREATE TABLE IF NOT EXISTS _migrations (
        id         SERIAL PRIMARY KEY,
        filename   TEXT UNIQUE NOT NULL,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    // Get already-applied filenames
    const { rows } = await client.query<{ filename: string }>(
      "SELECT filename FROM _migrations ORDER BY filename"
    );
    const applied = new Set(rows.map((r) => r.filename));

    // Bootstrap: if table was just created (or empty) but schema already exists,
    // seed history so we don't re-apply old migrations on an existing DB.
    if (applied.size === 0) {
      await bootstrapHistory(client, applied);
    }

    // Read migration files (sorted, .sql only, exclude meta/)
    const files = (await readdir(MIGRATIONS_DIR))
      .filter((f) => f.endsWith(".sql"))
      .sort();

    let pending = 0;
    for (const file of files) {
      if (applied.has(file)) continue;
      pending++;

      console.log(`[migrate] Applying ${file}...`);
      const sql = await readFile(join(MIGRATIONS_DIR, file), "utf-8");

      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query("INSERT INTO _migrations (filename) VALUES ($1)", [file]);
        await client.query("COMMIT");
        console.log(`[migrate] ✓ ${file}`);
      } catch (err) {
        await client.query("ROLLBACK");
        throw new Error(
          `Migration failed: ${file}\n${err instanceof Error ? err.message : err}`
        );
      }
    }

    if (pending === 0) {
      console.log("[migrate] All migrations already applied");
    }
  } finally {
    client.release();
  }
}

/**
 * Seeds _migrations history when the tracker is empty but the DB already has schema.
 * Inspects actual DB state to determine which migrations were applied manually.
 */
async function bootstrapHistory(
  client: PoolClient,
  applied: Set<string>
): Promise<void> {
  // Check if documents table exists (0000_initial.sql was applied)
  const { rows: tableCheck } = await client.query<{ table_name: string }>(`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'documents'
  `);

  if (tableCheck.length === 0) return; // Fresh DB — nothing to bootstrap

  console.log("[migrate] Existing schema detected — bootstrapping migration history");

  await client.query(
    "INSERT INTO _migrations (filename) VALUES ($1) ON CONFLICT DO NOTHING",
    ["0000_initial.sql"]
  );
  applied.add("0000_initial.sql");

  // Check if 'youtube' content_type enum value exists (0001_add_youtube_content_type.sql)
  const { rows: enumCheck } = await client.query<{ enumlabel: string }>(`
    SELECT e.enumlabel FROM pg_enum e
    JOIN pg_type t ON e.enumtypid = t.oid
    WHERE t.typname = 'content_type' AND e.enumlabel = 'youtube'
  `);

  if (enumCheck.length > 0) {
    await client.query(
      "INSERT INTO _migrations (filename) VALUES ($1) ON CONFLICT DO NOTHING",
      ["0001_add_youtube_content_type.sql"]
    );
    applied.add("0001_add_youtube_content_type.sql");
  }

  // Check if topics table exists (0002_add_topics.sql was applied manually)
  const { rows: topicsCheck } = await client.query<{ table_name: string }>(`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'topics'
  `);

  if (topicsCheck.length > 0) {
    await client.query(
      "INSERT INTO _migrations (filename) VALUES ($1) ON CONFLICT DO NOTHING",
      ["0002_add_topics.sql"]
    );
    applied.add("0002_add_topics.sql");
  }
}
