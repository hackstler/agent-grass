-- Step 1: Add role column (nullable initially)
ALTER TABLE users ADD COLUMN IF NOT EXISTS role text;

-- Step 2: Backfill role from metadata JSONB
UPDATE users SET role = COALESCE(metadata->>'role', 'user') WHERE role IS NULL;

-- Step 3: Make role NOT NULL with default
ALTER TABLE users ALTER COLUMN role SET NOT NULL;
ALTER TABLE users ALTER COLUMN role SET DEFAULT 'user';

-- Step 4: Backfill users.org_id for any NULL rows
UPDATE users SET org_id = COALESCE(email, id::text) WHERE org_id IS NULL;

-- Step 5: Make users.org_id NOT NULL
ALTER TABLE users ALTER COLUMN org_id SET NOT NULL;

-- Step 6: Backfill documents.org_id for any NULL rows
UPDATE documents SET org_id = 'default' WHERE org_id IS NULL;

-- Step 7: Make documents.org_id NOT NULL
ALTER TABLE documents ALTER COLUMN org_id SET NOT NULL;
