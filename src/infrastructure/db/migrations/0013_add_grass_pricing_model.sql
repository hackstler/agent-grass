CREATE TABLE "grass_pricing" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"catalog_item_id" uuid NOT NULL,
	"surface_type" text NOT NULL,
	"m2" integer NOT NULL,
	"price_per_m2" numeric(10, 2) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "quotes" ADD COLUMN "quote_data" jsonb;--> statement-breakpoint
ALTER TABLE "quotes" ADD COLUMN "surface_type" text;--> statement-breakpoint
ALTER TABLE "quotes" ADD COLUMN "area_m2" numeric(10, 2);--> statement-breakpoint
ALTER TABLE "quotes" ADD COLUMN "perimeter_lm" numeric(10, 2);--> statement-breakpoint
ALTER TABLE "quotes" ADD COLUMN "province" text;--> statement-breakpoint
ALTER TABLE "grass_pricing" ADD CONSTRAINT "grass_pricing_catalog_item_id_catalog_items_id_fk" FOREIGN KEY ("catalog_item_id") REFERENCES "public"."catalog_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "grass_pricing_lookup_idx" ON "grass_pricing" USING btree ("catalog_item_id","surface_type","m2");--> statement-breakpoint
CREATE UNIQUE INDEX "grass_pricing_unique_entry" ON "grass_pricing" USING btree ("catalog_item_id","surface_type","m2");