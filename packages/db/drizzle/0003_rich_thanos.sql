ALTER TABLE "agent_run" ADD COLUMN "trace_id" uuid;--> statement-breakpoint
UPDATE "agent_run" SET "trace_id" = gen_random_uuid() WHERE "trace_id" IS NULL;--> statement-breakpoint
ALTER TABLE "agent_run" ALTER COLUMN "trace_id" SET NOT NULL;--> statement-breakpoint
CREATE INDEX "agent_run_trace_id_idx" ON "agent_run" USING btree ("trace_id");
