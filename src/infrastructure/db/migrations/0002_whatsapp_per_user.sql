-- Migration: Move whatsapp_sessions from per-org to per-user
-- Drop the old unique constraint on org_id (sessions are now per-user, not per-org)
ALTER TABLE whatsapp_sessions DROP CONSTRAINT IF EXISTS whatsapp_sessions_org_id_unique;

-- Add the user_id column (nullable initially for backfill)
ALTER TABLE whatsapp_sessions ADD COLUMN user_id UUID REFERENCES users(id) ON DELETE CASCADE;

-- Backfill: assign each session to the oldest admin user in that org
UPDATE whatsapp_sessions ws SET user_id = (
  SELECT u.id FROM users u
  WHERE u.org_id = ws.org_id AND u.metadata->>'role' = 'admin'
  ORDER BY u.created_at ASC LIMIT 1
);

-- If any sessions still have NULL user_id (no admin found), fall back to oldest user in org
UPDATE whatsapp_sessions ws SET user_id = (
  SELECT u.id FROM users u
  WHERE u.org_id = ws.org_id
  ORDER BY u.created_at ASC LIMIT 1
) WHERE ws.user_id IS NULL;

-- Now enforce NOT NULL
ALTER TABLE whatsapp_sessions ALTER COLUMN user_id SET NOT NULL;

-- Add unique constraint: one session per user
ALTER TABLE whatsapp_sessions ADD CONSTRAINT whatsapp_sessions_user_id_unique UNIQUE (user_id);
