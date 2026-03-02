import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import { resolve } from "path";
import * as schema from "./schema.js";

const DATABASE_URL = process.env["DATABASE_URL"];
if (!DATABASE_URL) {
  throw new Error("DATABASE_URL environment variable is required");
}

const pool = new Pool({
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

export async function runMigrations(): Promise<void> {
  const { existsSync } = await import("fs");
  const candidates = [
    resolve(process.cwd(), "dist", "infrastructure", "db", "migrations"),
    resolve(process.cwd(), "src", "infrastructure", "db", "migrations"),
  ];
  const migrationsFolder = candidates.find((p) => existsSync(resolve(p, "meta", "_journal.json")));
  if (!migrationsFolder) {
    console.warn("[migrations] no migrations folder found, skipping");
    return;
  }
  console.log(`[migrations] using ${migrationsFolder}`);
  await migrate(db, { migrationsFolder });
}
