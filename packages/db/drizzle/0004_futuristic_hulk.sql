ALTER TABLE "website_session" ADD COLUMN "pinned_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "website_session" ADD COLUMN "cloned_from_session_id" uuid;--> statement-breakpoint
CREATE INDEX "website_session_pinned_at_idx" ON "website_session" USING btree ("website_id","pinned_at");--> statement-breakpoint
CREATE INDEX "website_session_clone_source_idx" ON "website_session" USING btree ("cloned_from_session_id");