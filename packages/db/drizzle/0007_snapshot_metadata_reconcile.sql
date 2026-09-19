ALTER TABLE "template" ADD COLUMN IF NOT EXISTS "artifact_type" varchar(64) DEFAULT 'legacy-theme-reference' NOT NULL;--> statement-breakpoint
ALTER TABLE "template" ADD COLUMN IF NOT EXISTS "snapshot_schema_version" integer;--> statement-breakpoint
ALTER TABLE "template" ADD COLUMN IF NOT EXISTS "source_pboot_version" varchar(32);--> statement-breakpoint
ALTER TABLE "template" ADD COLUMN IF NOT EXISTS "source_core_commit" varchar(64);--> statement-breakpoint
ALTER TABLE "template" ADD COLUMN IF NOT EXISTS "db_engine" varchar(32);--> statement-breakpoint
ALTER TABLE "template" ADD COLUMN IF NOT EXISTS "db_schema_version" varchar(32);--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'template_artifact_type_check') THEN
    ALTER TABLE "template" ADD CONSTRAINT "template_artifact_type_check" CHECK ("template"."artifact_type" in ('legacy-theme-reference', 'cloudcrane-pboot-site-snapshot'));
  END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'template_snapshot_metadata_check') THEN
    ALTER TABLE "template" ADD CONSTRAINT "template_snapshot_metadata_check" CHECK (("template"."artifact_type" = 'legacy-theme-reference' OR ("template"."snapshot_schema_version" is not null and "template"."source_pboot_version" is not null and "template"."source_core_commit" is not null and "template"."db_engine" is not null and "template"."db_schema_version" is not null)));
  END IF;
END $$;
