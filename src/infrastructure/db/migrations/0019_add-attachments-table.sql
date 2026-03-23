CREATE TABLE "attachments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" text NOT NULL,
	"user_id" uuid,
	"filename" text NOT NULL,
	"mimetype" text NOT NULL,
	"base64" text NOT NULL,
	"doc_type" text NOT NULL,
	"source_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "attachments_user_filename_uq" ON "attachments" USING btree ("user_id","filename");--> statement-breakpoint
CREATE INDEX "attachments_user_doc_type_idx" ON "attachments" USING btree ("user_id","doc_type");