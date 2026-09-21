CREATE TABLE IF NOT EXISTS "website_share" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"website_id" uuid NOT NULL,
	"token_hash" varchar(64) NOT NULL,
	"expires_at" timestamptz NOT NULL,
	"revoked_at" timestamptz,
	"created_at" timestamptz DEFAULT now() NOT NULL,
	"last_access_at" timestamptz,
	"access_count" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "website_share_token_hash_unique" UNIQUE("token_hash"),
	CONSTRAINT "website_share_token_hash_check" CHECK ("website_share"."token_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "website_share_access_count_check" CHECK ("website_share"."access_count" >= 0)
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "website_share" ADD CONSTRAINT "website_share_website_id_website_id_fk" FOREIGN KEY ("website_id") REFERENCES "public"."website"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "website_share_website_id_idx" ON "website_share" USING btree ("website_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "website_share_expires_at_idx" ON "website_share" USING btree ("expires_at");
