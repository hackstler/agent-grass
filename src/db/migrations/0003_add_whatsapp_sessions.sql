CREATE TABLE IF NOT EXISTS "whatsapp_sessions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "org_id" text NOT NULL,
  "status" text DEFAULT 'disconnected' NOT NULL,
  "qr_data" text,
  "phone" text,
  "updated_at" timestamptz DEFAULT now() NOT NULL
);

DO $$ BEGIN
  ALTER TABLE "whatsapp_sessions" ADD CONSTRAINT "whatsapp_sessions_org_id_unique" UNIQUE("org_id");
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
