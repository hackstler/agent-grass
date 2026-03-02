-- Fix: drop the correct unique constraint on org_id
-- The 0002 migration used the wrong constraint name (whatsapp_sessions_org_id_unique)
-- The actual Drizzle-generated name is whatsapp_sessions_org_id_key
ALTER TABLE whatsapp_sessions DROP CONSTRAINT IF EXISTS whatsapp_sessions_org_id_key;
ALTER TABLE whatsapp_sessions DROP CONSTRAINT IF EXISTS whatsapp_sessions_org_id_unique;
