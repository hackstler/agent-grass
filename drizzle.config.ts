import type { Config } from "drizzle-kit";

export default {
  schema: "./src/infrastructure/db/schema.ts",
  out: "./src/infrastructure/db/migrations",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env["DATABASE_URL"] ?? "postgresql://dev:dev@localhost:5432/ragdb",
  },
  verbose: true,
  strict: true,
} satisfies Config;
