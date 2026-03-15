-- Drop the business_settings column if it exists (from a previous local-only migration)
ALTER TABLE "organizations" DROP COLUMN IF EXISTS "business_settings";--> statement-breakpoint
ALTER TABLE "catalogs" ADD COLUMN "settings" jsonb;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "quote_settings" jsonb;
