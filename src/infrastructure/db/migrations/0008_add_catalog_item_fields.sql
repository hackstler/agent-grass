ALTER TABLE "catalog_items" ADD COLUMN IF NOT EXISTS "description" text;
ALTER TABLE "catalog_items" ADD COLUMN IF NOT EXISTS "category" text;
ALTER TABLE "catalog_items" ADD COLUMN IF NOT EXISTS "is_active" boolean NOT NULL DEFAULT true;
ALTER TABLE "catalogs" ADD COLUMN IF NOT EXISTS "updated_at" timestamp with time zone NOT NULL DEFAULT now();
CREATE UNIQUE INDEX IF NOT EXISTS "catalog_items_catalog_code_uq" ON "catalog_items" ("catalog_id", "code");
