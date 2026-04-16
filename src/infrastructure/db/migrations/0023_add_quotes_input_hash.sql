ALTER TABLE "quotes" ADD COLUMN "input_hash" text;--> statement-breakpoint
CREATE INDEX "quotes_user_input_hash_idx" ON "quotes" USING btree ("user_id","input_hash");