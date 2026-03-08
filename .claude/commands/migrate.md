# Database Migration — Drizzle Kit Workflow

**MANDATORY**: This is the ONLY way to create database migrations in this project. NEVER write migration SQL files by hand. NEVER manually edit `meta/_journal.json`. NEVER manually create snapshot files.

## How It Works

`drizzle-kit generate` is an OFFLINE tool that:
1. Reads the latest snapshot from `src/infrastructure/db/migrations/meta/`
2. Diffs it against the current TypeScript schema in `src/infrastructure/db/schema.ts`
3. Auto-generates: SQL migration file + snapshot file + journal entry

The runtime `migrate()` in `src/infrastructure/db/client.ts` applies pending migrations on startup.

## Step-by-Step Workflow

### Step 1 — Modify the Schema

Edit `src/infrastructure/db/schema.ts` with the desired changes (add columns, tables, indexes, etc.).

### Step 2 — Generate the Migration

```bash
cd agent-api
npx drizzle-kit generate --name=<descriptive_name>
```

- Use a descriptive snake_case name: `add_phone_to_users`, `create_payments_table`, etc.
- drizzle-kit will auto-create:
  - `src/infrastructure/db/migrations/NNNN_<name>.sql` — the SQL
  - `src/infrastructure/db/migrations/meta/NNNN_snapshot.json` — schema snapshot
  - Updated `src/infrastructure/db/migrations/meta/_journal.json` — migration registry

### Step 3 — Review the Generated SQL

Read the generated `.sql` file and verify:
- It contains ONLY the expected changes (no extra tables, no duplicate alterations)
- `ALTER TABLE ... ADD COLUMN` statements are correct
- `CREATE TABLE` is only for genuinely new tables
- No destructive operations unless intended (DROP, ALTER TYPE, etc.)

If the SQL includes unexpected changes (tables/columns from old hand-written migrations), it means the snapshot chain was broken. Do NOT proceed — investigate.

### Step 4 — Update Domain Entities (if needed)

If you added/changed columns, update the corresponding domain entity in `src/domain/entities/index.ts` to match. Also update repository ports and implementations as needed.

### Step 5 — Type Check

```bash
npx tsc --noEmit
```

Must pass with 0 errors.

### Step 6 — Verify No Remaining Diff

```bash
npx drizzle-kit generate --name=verify_clean
```

Expected output: `No schema changes, nothing to migrate 😴`

If it generates a migration, something is wrong — the schema and snapshot are out of sync.

## NEVER Do These

- ❌ Write `.sql` migration files by hand
- ❌ Edit `meta/_journal.json` manually
- ❌ Create or modify `meta/*_snapshot.json` files
- ❌ Use `drizzle-kit push` in production (it skips migration files)
- ❌ Copy migration SQL from another project or AI suggestion without using `generate`

## Data-Only Migrations (no schema change)

For migrations that only manipulate data (INSERT, UPDATE, backfill), not schema:

```bash
npx drizzle-kit generate --custom --name=backfill_user_roles
```

This creates an empty `.sql` file + snapshot + journal entry. Then fill in the SQL manually with your data migration statements.

## Troubleshooting

### "generate" produces unexpected changes
The snapshot chain may be out of sync. Check:
1. `ls src/infrastructure/db/migrations/meta/` — should have `_journal.json` + one `NNNN_snapshot.json` per generated migration
2. The latest snapshot should represent the FULL current schema

### Migration fails on deploy
Check Railway/production logs for the specific SQL error. Common issues:
- Column/table already exists → add `IF NOT EXISTS` to the generated SQL
- Column doesn't exist for DROP → migration was already partially applied

### drizzle.config.ts reference
```typescript
export default {
  schema: "./src/infrastructure/db/schema.ts",
  out: "./src/infrastructure/db/migrations",
  dialect: "postgresql",
} satisfies Config;
```
