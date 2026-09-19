CREATE TABLE IF NOT EXISTS "template" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "source_website_id" uuid REFERENCES "website"("id") ON DELETE SET NULL,
  "name" varchar(120) NOT NULL,
  "description" text NOT NULL,
  "category" varchar(64) NOT NULL,
  "cover_url" text,
  "demo_url" text,
  "cms_type" varchar(64) NOT NULL,
  "artifact_storage_key" text NOT NULL UNIQUE,
  "artifact_sha256" varchar(64) NOT NULL,
  "artifact_size" integer NOT NULL,
  "status" varchar(32) NOT NULL,
  "sort_order" integer DEFAULT 0 NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  "published_at" timestamptz
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "template_status_sort_order_idx" ON "template" USING btree ("status", "sort_order");
--> statement-breakpoint
ALTER TABLE "template" ADD CONSTRAINT "template_status_check" CHECK ("status" IN ('draft', 'published', 'hidden'));
--> statement-breakpoint
ALTER TABLE "template" ADD CONSTRAINT "template_artifact_sha256_check" CHECK ("artifact_sha256" ~ '^[0-9a-f]{64}$');
--> statement-breakpoint
ALTER TABLE "template" ADD CONSTRAINT "template_artifact_size_check" CHECK ("artifact_size" > 0);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "website_template_attachment" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "website_id" uuid NOT NULL UNIQUE REFERENCES "website"("id") ON DELETE CASCADE,
  "template_id" uuid NOT NULL REFERENCES "template"("id") ON DELETE RESTRICT,
  "artifact_storage_key" text NOT NULL,
  "artifact_sha256" varchar(64) NOT NULL,
  "reference_id" varchar(128),
  "status" varchar(32) NOT NULL,
  "attempt_count" integer DEFAULT 0 NOT NULL,
  "last_error_code" varchar(64),
  "last_error_message" text,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  "completed_at" timestamptz
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "website_template_attachment_template_id_idx" ON "website_template_attachment" USING btree ("template_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "website_template_attachment_status_idx" ON "website_template_attachment" USING btree ("status");
--> statement-breakpoint
ALTER TABLE "website_template_attachment" ADD CONSTRAINT "website_template_attachment_status_check" CHECK ("status" IN ('pending', 'materializing', 'ready', 'failed'));
