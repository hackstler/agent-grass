ALTER TABLE "whatsapp_sessions" ADD COLUMN IF NOT EXISTS "linking_method" text DEFAULT 'qr' NOT NULL;--> statement-breakpoint
ALTER TABLE "whatsapp_sessions" ADD COLUMN IF NOT EXISTS "pairing_code" text;--> statement-breakpoint
ALTER TABLE "whatsapp_sessions" ADD COLUMN IF NOT EXISTS "phone_number" text;