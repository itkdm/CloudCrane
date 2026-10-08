CREATE TABLE "production_domain" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"production_runtime_id" uuid NOT NULL,
	"slug" varchar(63) NOT NULL,
	"route_type" varchar(16) DEFAULT 'canonical' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "production_domain_slug_unique" UNIQUE("slug"),
	CONSTRAINT "production_domain_slug_check" CHECK ("production_domain"."slug" ~ '^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$'),
	CONSTRAINT "production_domain_route_type_check" CHECK ("production_domain"."route_type" in ('canonical', 'redirect'))
);
--> statement-breakpoint
ALTER TABLE "production_runtime" ALTER COLUMN "production_slug" SET DATA TYPE varchar(63);--> statement-breakpoint
ALTER TABLE "production_domain" ADD CONSTRAINT "production_domain_production_runtime_id_production_runtime_id_fk" FOREIGN KEY ("production_runtime_id") REFERENCES "public"."production_runtime"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "production_domain_runtime_canonical_unique" ON "production_domain" USING btree ("production_runtime_id") WHERE "production_domain"."route_type" = 'canonical';--> statement-breakpoint
CREATE INDEX "production_domain_runtime_idx" ON "production_domain" USING btree ("production_runtime_id");
--> statement-breakpoint
INSERT INTO "production_domain" ("production_runtime_id", "slug", "route_type")
SELECT "id", "production_slug", 'canonical' FROM "production_runtime"
ON CONFLICT ("slug") DO NOTHING;
