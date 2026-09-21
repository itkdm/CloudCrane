CREATE TABLE IF NOT EXISTS "conversation_attachment" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" text NOT NULL,
	"website_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"original_filename" varchar(255) NOT NULL,
	"content_type" varchar(127) NOT NULL,
	"kind" varchar(32) NOT NULL,
	"size_bytes" bigint NOT NULL,
	"sha256" varchar(64) NOT NULL,
	"storage_driver" varchar(16) NOT NULL,
	"storage_key" text NOT NULL,
	"status" varchar(32) NOT NULL,
	"error_code" varchar(128),
	"created_at" timestamptz DEFAULT now() NOT NULL,
	"expires_at" timestamptz NOT NULL,
	"deleted_at" timestamptz,
	CONSTRAINT "conversation_attachment_storage_key_unique" UNIQUE("storage_key"),
	CONSTRAINT "conversation_attachment_kind_check" CHECK ("conversation_attachment"."kind" in ('image', 'document')),
	CONSTRAINT "conversation_attachment_status_check" CHECK ("conversation_attachment"."status" in ('ready', 'failed', 'deleting', 'deleted')),
	CONSTRAINT "conversation_attachment_size_check" CHECK ("conversation_attachment"."size_bytes" > 0),
	CONSTRAINT "conversation_attachment_sha256_check" CHECK ("conversation_attachment"."sha256" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "conversation_attachment" ADD CONSTRAINT "conversation_attachment_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "conversation_attachment" ADD CONSTRAINT "conversation_attachment_website_id_website_id_fk" FOREIGN KEY ("website_id") REFERENCES "public"."website"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "conversation_attachment" ADD CONSTRAINT "conversation_attachment_session_id_website_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."website_session"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "conversation_attachment_owner_session_idx" ON "conversation_attachment" USING btree ("owner_id","session_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "conversation_attachment_website_status_idx" ON "conversation_attachment" USING btree ("website_id","status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "conversation_attachment_expiry_idx" ON "conversation_attachment" USING btree ("status","expires_at");
