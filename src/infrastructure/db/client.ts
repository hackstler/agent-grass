import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { resolve } from "path";
import { readdirSync, readFileSync } from "fs";
import * as schema from "./schema.js";

const DATABASE_URL = process.env["DATABASE_URL"];
if (!DATABASE_URL) {
  throw new Error("DATABASE_URL environment variable is required");
}

export const pool = new Pool({
  connectionString: DATABASE_URL,
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
});

export const db = drizzle(pool, { schema, logger: process.env["LOG_LEVEL"] === "debug" });

export async function checkDbConnection(): Promise<boolean> {
  try {
    const client = await pool.connect();
    await client.query("SELECT 1");
    client.release();
    return true;
  } catch {
    return false;
  }
}

export async function ensurePgVector(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("CREATE EXTENSION IF NOT EXISTS vector");
  } finally {
    client.release();
  }
}

/**
 * Simple migration runner — no journals, no snapshots, no bullshit.
 * Reads .sql files from the migrations folder, sorted by name.
 * Tracks applied migrations in a `_migrations` table.
 * Add a new .sql file → it runs automatically on next startup.
 */
export async function runMigrations(): Promise<void> {
  const base = process.env["NODE_ENV"] === "production"
    ? "dist/infrastructure/db/migrations"
    : "src/infrastructure/db/migrations";
  const migrationsFolder = resolve(process.cwd(), base);

  const client = await pool.connect();
  try {
    // Ensure tracking table exists
    await client.query(`
      CREATE TABLE IF NOT EXISTS _migrations (
        name TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);

    // Get already-applied migrations
    const { rows: applied } = await client.query<{ name: string }>(
      "SELECT name FROM _migrations ORDER BY name"
    );
    const appliedSet = new Set(applied.map((r) => r.name));

    // Read .sql files, sorted by name
    const files = readdirSync(migrationsFolder)
      .filter((f) => f.endsWith(".sql"))
      .sort();

    for (const file of files) {
      if (appliedSet.has(file)) continue;

      const sql = readFileSync(resolve(migrationsFolder, file), "utf-8");
      console.log(`[migrations] applying ${file}...`);

      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query("INSERT INTO _migrations (name) VALUES ($1)", [file]);
        await client.query("COMMIT");
        console.log(`[migrations] ✓ ${file}`);
      } catch (err) {
        await client.query("ROLLBACK");
        throw new Error(
          `Migration ${file} failed: ${err instanceof Error ? err.message : err}`
        );
      }
    }
  } finally {
    client.release();
  }
}

