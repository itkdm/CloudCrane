ALTER TABLE "audit_event" DROP CONSTRAINT IF EXISTS "audit_event_actor_user_id_user_id_fk";
--> statement-breakpoint
ALTER TABLE "audit_event" DROP CONSTRAINT IF EXISTS "audit_event_impersonator_user_id_user_id_fk";
--> statement-breakpoint
ALTER TABLE "audit_event" DROP CONSTRAINT IF EXISTS "audit_event_website_id_website_id_fk";
--> statement-breakpoint
ALTER TABLE "audit_event" DROP CONSTRAINT IF EXISTS "audit_event_workspace_id_workspace_id_fk";
--> statement-breakpoint
ALTER TABLE "audit_event" DROP CONSTRAINT IF EXISTS "audit_event_website_session_id_website_session_id_fk";
--> statement-breakpoint
ALTER TABLE "audit_event" DROP CONSTRAINT IF EXISTS "audit_event_agent_run_id_agent_run_id_fk";
