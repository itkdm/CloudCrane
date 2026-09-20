CREATE TABLE "audit_event" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"actor_type" varchar(32) NOT NULL,
	"actor_user_id" text,
	"impersonator_user_id" text,
	"website_id" uuid,
	"workspace_id" uuid,
	"website_session_id" uuid,
	"agent_run_id" uuid,
	"trace_id" varchar(32),
	"span_id" varchar(16),
	"run_correlation_id" uuid,
	"request_id" varchar(255),
	"tool_call_id" varchar(255),
	"idempotency_key" varchar(255),
	"operation" varchar(128) NOT NULL,
	"resource_type" varchar(64),
	"resource_ref" text,
	"status" varchar(32) NOT NULL,
	"duration_ms" integer,
	"error_code" varchar(128),
	"error_type" varchar(128),
	"request_summary" jsonb,
	"result_summary" jsonb,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	CONSTRAINT "audit_event_actor_type_check" CHECK ("audit_event"."actor_type" in ('user', 'agent', 'gateway', 'runner', 'system', 'admin')),
	CONSTRAINT "audit_event_status_check" CHECK ("audit_event"."status" in ('PENDING', 'RUNNING', 'SUCCESS', 'FAILED', 'TIMEOUT', 'CANCELLED', 'UNKNOWN')),
	CONSTRAINT "audit_event_duration_check" CHECK ("audit_event"."duration_ms" is null or "audit_event"."duration_ms" >= 0)
);
--> statement-breakpoint
ALTER TABLE "audit_event" ADD CONSTRAINT "audit_event_actor_user_id_user_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_event" ADD CONSTRAINT "audit_event_impersonator_user_id_user_id_fk" FOREIGN KEY ("impersonator_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_event" ADD CONSTRAINT "audit_event_website_id_website_id_fk" FOREIGN KEY ("website_id") REFERENCES "public"."website"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_event" ADD CONSTRAINT "audit_event_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_event" ADD CONSTRAINT "audit_event_website_session_id_website_session_id_fk" FOREIGN KEY ("website_session_id") REFERENCES "public"."website_session"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_event" ADD CONSTRAINT "audit_event_agent_run_id_agent_run_id_fk" FOREIGN KEY ("agent_run_id") REFERENCES "public"."agent_run"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_event_occurred_at_idx" ON "audit_event" USING btree ("occurred_at");--> statement-breakpoint
CREATE INDEX "audit_event_operation_status_idx" ON "audit_event" USING btree ("operation","status");--> statement-breakpoint
CREATE INDEX "audit_event_workspace_occurred_at_idx" ON "audit_event" USING btree ("workspace_id","occurred_at");--> statement-breakpoint
CREATE INDEX "audit_event_agent_run_occurred_at_idx" ON "audit_event" USING btree ("agent_run_id","occurred_at");--> statement-breakpoint
CREATE INDEX "audit_event_trace_id_idx" ON "audit_event" USING btree ("trace_id");--> statement-breakpoint
CREATE INDEX "audit_event_request_id_idx" ON "audit_event" USING btree ("request_id");--> statement-breakpoint
ALTER TABLE "audit_event" ADD CONSTRAINT "audit_event_finished_at_check" CHECK ((("audit_event"."status" in ('PENDING', 'RUNNING') and "audit_event"."finished_at" is null) or ("audit_event"."status" in ('SUCCESS', 'FAILED', 'TIMEOUT', 'CANCELLED', 'UNKNOWN') and "audit_event"."finished_at" is not null)));--> statement-breakpoint
CREATE OR REPLACE FUNCTION cloudcrane_guard_audit_event() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'audit_event is append-only';
  END IF;
  IF OLD.status NOT IN ('PENDING', 'RUNNING')
     OR NEW.status NOT IN ('SUCCESS', 'FAILED', 'TIMEOUT', 'CANCELLED', 'UNKNOWN')
     OR NEW.finished_at IS NULL
     OR OLD.id IS DISTINCT FROM NEW.id
     OR OLD.occurred_at IS DISTINCT FROM NEW.occurred_at
     OR OLD.actor_type IS DISTINCT FROM NEW.actor_type
     OR OLD.actor_user_id IS DISTINCT FROM NEW.actor_user_id
     OR OLD.impersonator_user_id IS DISTINCT FROM NEW.impersonator_user_id
     OR OLD.website_id IS DISTINCT FROM NEW.website_id
     OR OLD.workspace_id IS DISTINCT FROM NEW.workspace_id
     OR OLD.website_session_id IS DISTINCT FROM NEW.website_session_id
     OR OLD.agent_run_id IS DISTINCT FROM NEW.agent_run_id
     OR OLD.trace_id IS DISTINCT FROM NEW.trace_id
     OR OLD.span_id IS DISTINCT FROM NEW.span_id
     OR OLD.run_correlation_id IS DISTINCT FROM NEW.run_correlation_id
     OR OLD.request_id IS DISTINCT FROM NEW.request_id
     OR OLD.tool_call_id IS DISTINCT FROM NEW.tool_call_id
     OR OLD.idempotency_key IS DISTINCT FROM NEW.idempotency_key
     OR OLD.operation IS DISTINCT FROM NEW.operation
     OR OLD.resource_type IS DISTINCT FROM NEW.resource_type
     OR OLD.resource_ref IS DISTINCT FROM NEW.resource_ref
     OR OLD.request_summary IS DISTINCT FROM NEW.request_summary THEN
    RAISE EXCEPTION 'audit_event is immutable except for terminal finalization';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER audit_event_append_only_guard BEFORE UPDATE OR DELETE ON "audit_event" FOR EACH ROW EXECUTE FUNCTION cloudcrane_guard_audit_event();
