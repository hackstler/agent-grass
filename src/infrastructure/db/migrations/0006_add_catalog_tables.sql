CREATE TABLE IF NOT EXISTS "catalogs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "org_id" text NOT NULL,
  "name" text NOT NULL,
  "effective_date" timestamp with time zone NOT NULL,
  "is_active" boolean NOT NULL DEFAULT true,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "catalog_items" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "catalog_id" uuid NOT NULL REFERENCES "catalogs"("id") ON DELETE CASCADE,
  "code" integer NOT NULL,
  "name" text NOT NULL,
  "price_per_unit" numeric(10, 2) NOT NULL,
  "unit" text NOT NULL,
  "sort_order" integer NOT NULL DEFAULT 0,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "catalog_items_catalog_id_idx" ON "catalog_items" USING btree ("catalog_id");
