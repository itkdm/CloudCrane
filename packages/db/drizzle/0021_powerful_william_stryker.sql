CREATE TABLE "production_runtime" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"website_id" uuid NOT NULL,
	"runner_id" uuid,
	"status" varchar(32) DEFAULT 'provisioning' NOT NULL,
	"production_slug" varchar(64) NOT NULL,
	"container_ref" text,
	"production_port" integer,
	"current_release_id" uuid,
	"last_error_code" varchar(128),
	"last_error_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"activated_at" timestamp with time zone,
	CONSTRAINT "production_runtime_website_id_unique" UNIQUE("website_id"),
	CONSTRAINT "production_runtime_production_slug_unique" UNIQUE("production_slug"),
	CONSTRAINT "production_runtime_status_check" CHECK ("production_runtime"."status" in ('provisioning', 'authorization_required', 'active', 'failed', 'stopped', 'deleting')),
	CONSTRAINT "production_runtime_port_check" CHECK ("production_runtime"."production_port" is null or ("production_runtime"."production_port" > 0 and "production_runtime"."production_port" < 65536))
);
--> statement-breakpoint
CREATE TABLE "website_release" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"website_id" uuid NOT NULL,
	"sequence" integer NOT NULL,
	"status" varchar(32) DEFAULT 'preparing' NOT NULL,
	"artifact_storage_key" text,
	"artifact_sha256" varchar(64),
	"artifact_size" bigint,
	"source_git_head" varchar(64),
	"source_git_dirty" boolean DEFAULT false NOT NULL,
	"source_pboot_version" varchar(32),
	"source_core_commit" varchar(64),
	"previous_release_id" uuid,
	"created_by_user_id" text,
	"error_code" varchar(128),
	"error_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"staged_at" timestamp with time zone,
	"activated_at" timestamp with time zone,
	CONSTRAINT "website_release_artifact_storage_key_unique" UNIQUE("artifact_storage_key"),
	CONSTRAINT "website_release_sequence_check" CHECK ("website_release"."sequence" > 0),
	CONSTRAINT "website_release_status_check" CHECK ("website_release"."status" in ('preparing', 'staged', 'activating', 'active', 'superseded', 'failed')),
	CONSTRAINT "website_release_sha256_check" CHECK ("website_release"."artifact_sha256" is null or "website_release"."artifact_sha256" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "website_release_artifact_size_check" CHECK ("website_release"."artifact_size" is null or "website_release"."artifact_size" > 0)
);
--> statement-breakpoint
ALTER TABLE "production_runtime" ADD CONSTRAINT "production_runtime_website_id_website_id_fk" FOREIGN KEY ("website_id") REFERENCES "public"."website"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_runtime" ADD CONSTRAINT "production_runtime_runner_id_runner_id_fk" FOREIGN KEY ("runner_id") REFERENCES "public"."runner"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_runtime" ADD CONSTRAINT "production_runtime_current_release_id_website_release_id_fk" FOREIGN KEY ("current_release_id") REFERENCES "public"."website_release"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "website_release" ADD CONSTRAINT "website_release_website_id_website_id_fk" FOREIGN KEY ("website_id") REFERENCES "public"."website"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "website_release" ADD CONSTRAINT "website_release_previous_release_id_website_release_id_fk" FOREIGN KEY ("previous_release_id") REFERENCES "public"."website_release"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "website_release" ADD CONSTRAINT "website_release_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "production_runtime_status_idx" ON "production_runtime" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "website_release_website_sequence_unique" ON "website_release" USING btree ("website_id","sequence");--> statement-breakpoint
CREATE UNIQUE INDEX "website_release_one_active_per_website_unique" ON "website_release" USING btree ("website_id") WHERE "website_release"."status" = 'active';--> statement-breakpoint
CREATE INDEX "website_release_website_status_idx" ON "website_release" USING btree ("website_id","status");