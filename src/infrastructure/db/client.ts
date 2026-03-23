import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import { resolve } from "path";
import { existsSync } from "fs";
import * as schema from "./schema.js";
import { logger } from "../../shared/logger.js";

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

export async function runMigrations(): Promise<void> {
  // Try multiple candidate paths — covers Docker, Nixpacks, and dev
  const candidates = [
    resolve(process.cwd(), "dist/infrastructure/db/migrations"),
    resolve(process.cwd(), "src/infrastructure/db/migrations"),
  ];

  const migrationsFolder = candidates.find((p) =>
    existsSync(resolve(p, "meta", "_journal.json"))
  );

  if (!migrationsFolder) {
    logger.warn({ candidates }, "no meta/_journal.json found, skipping drizzle migrate — schema must already exist in DB");
    return;
  }

  logger.info({ migrationsFolder }, "using migrations folder");

  // Clean up broken auto-generated migration (0006_petite_anthem) that was deployed by mistake.
  // Its folderMillis was 1772905955669 — newer than the hand-written migrations,
  // which blocks drizzle from running them. Remove it so pending migrations can apply.
  try {
    const client = await pool.connect();
    try {
      await client.query(`DELETE FROM "drizzle"."__drizzle_migrations" WHERE created_at = 1772905955669`);
    } finally {
      client.release();
    }
  } catch {
    // Table/schema might not exist yet on first run — ignore
  }

  await migrate(db, { migrationsFolder });
}
