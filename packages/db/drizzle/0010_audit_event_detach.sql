-- Audit evidence is append-only and must survive deletion of the business
-- objects it describes.  The original audit migration added SET NULL foreign
-- keys, which still conflicts with the append-only trigger during deletes.
ALTER TABLE "audit_event" DROP CONSTRAINT IF EXISTS "audit_event_actor_user_id_user_id_fk";
ALTER TABLE "audit_event" DROP CONSTRAINT IF EXISTS "audit_event_impersonator_user_id_user_id_fk";
ALTER TABLE "audit_event" DROP CONSTRAINT IF EXISTS "audit_event_website_id_website_id_fk";
ALTER TABLE "audit_event" DROP CONSTRAINT IF EXISTS "audit_event_workspace_id_workspace_id_fk";
ALTER TABLE "audit_event" DROP CONSTRAINT IF EXISTS "audit_event_website_session_id_website_session_id_fk";
ALTER TABLE "audit_event" DROP CONSTRAINT IF EXISTS "audit_event_agent_run_id_agent_run_id_fk";
