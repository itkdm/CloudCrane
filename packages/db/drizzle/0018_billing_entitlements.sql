DO $$
DECLARE
  duplicate_website_count integer;
BEGIN
  SELECT count(*)
    INTO duplicate_website_count
    FROM (
      SELECT website_id
      FROM workspace
      GROUP BY website_id
      HAVING count(*) > 1
    ) duplicates;

  IF duplicate_website_count > 0 THEN
    RAISE EXCEPTION
      'cannot add workspace.website_id uniqueness: % website(s) have duplicate workspaces; no data was removed',
      duplicate_website_count;
  END IF;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "workspace_website_id_unique" ON "workspace" USING btree ("website_id");
--> statement-breakpoint
DROP INDEX IF EXISTS "workspace_website_id_idx";
--> statement-breakpoint
ALTER TABLE "website" ADD COLUMN IF NOT EXISTS "billing_account_id" uuid;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "website_billing_account_id_idx" ON "website" USING btree ("billing_account_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "billing_account" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" varchar(32) DEFAULT 'personal' NOT NULL,
	"personal_owner_user_id" text,
	"name" varchar(255) NOT NULL,
	"status" varchar(32) DEFAULT 'active' NOT NULL,
	"created_at" timestamptz DEFAULT now() NOT NULL,
	"updated_at" timestamptz DEFAULT now() NOT NULL,
	CONSTRAINT "billing_account_kind_check" CHECK ("billing_account"."kind" in ('personal', 'organization')),
	CONSTRAINT "billing_account_status_check" CHECK ("billing_account"."status" in ('active', 'suspended', 'closed')),
	CONSTRAINT "billing_account_personal_owner_user_fk" FOREIGN KEY ("personal_owner_user_id") REFERENCES "user"("id") ON DELETE SET NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "billing_account_status_idx" ON "billing_account" USING btree ("status");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "billing_account_personal_owner_unique" ON "billing_account" USING btree ("personal_owner_user_id") WHERE "billing_account"."kind" = 'personal' AND "billing_account"."status" = 'active';
--> statement-breakpoint
ALTER TABLE "website" ADD CONSTRAINT "website_billing_account_fk" FOREIGN KEY ("billing_account_id") REFERENCES "billing_account"("id") ON DELETE SET NULL;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "billing_account_member" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"billing_account_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"role" varchar(32) DEFAULT 'member' NOT NULL,
	"status" varchar(32) DEFAULT 'active' NOT NULL,
	"created_at" timestamptz DEFAULT now() NOT NULL,
	"updated_at" timestamptz DEFAULT now() NOT NULL,
	CONSTRAINT "billing_account_member_role_check" CHECK ("billing_account_member"."role" in ('owner', 'admin', 'member')),
	CONSTRAINT "billing_account_member_status_check" CHECK ("billing_account_member"."status" in ('invited', 'active', 'removed')),
	CONSTRAINT "billing_account_member_account_user_unique" UNIQUE ("billing_account_id", "user_id"),
	CONSTRAINT "billing_account_member_account_fk" FOREIGN KEY ("billing_account_id") REFERENCES "billing_account"("id") ON DELETE cascade,
	CONSTRAINT "billing_account_member_user_fk" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "billing_account_member_user_id_idx" ON "billing_account_member" USING btree ("user_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "plan" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" varchar(128) NOT NULL,
	"name" varchar(255) NOT NULL,
	"description" text,
	"status" varchar(32) DEFAULT 'draft' NOT NULL,
	"created_at" timestamptz DEFAULT now() NOT NULL,
	"updated_at" timestamptz DEFAULT now() NOT NULL,
	CONSTRAINT "plan_key_unique" UNIQUE ("key"),
	CONSTRAINT "plan_status_check" CHECK ("plan"."status" in ('draft', 'active', 'retired'))
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "plan_status_idx" ON "plan" USING btree ("status");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "plan_version" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"plan_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"display_name" varchar(255) NOT NULL,
	"description" text,
	"status" varchar(32) DEFAULT 'draft' NOT NULL,
	"billing_interval" varchar(32) DEFAULT 'month' NOT NULL,
	"interval_count" integer DEFAULT 1 NOT NULL,
	"price_amount" numeric(30, 0) DEFAULT 0 NOT NULL,
	"price_currency" varchar(3) DEFAULT 'USD' NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamptz DEFAULT now() NOT NULL,
	"published_at" timestamptz,
	CONSTRAINT "plan_version_plan_version_unique" UNIQUE ("plan_id", "version"),
	CONSTRAINT "plan_version_version_check" CHECK ("plan_version"."version" > 0),
	CONSTRAINT "plan_version_status_check" CHECK ("plan_version"."status" in ('draft', 'published', 'retired')),
	CONSTRAINT "plan_version_billing_interval_check" CHECK ("plan_version"."billing_interval" in ('month', 'year', 'one_time')),
	CONSTRAINT "plan_version_interval_count_check" CHECK ("plan_version"."interval_count" > 0),
	CONSTRAINT "plan_version_price_amount_check" CHECK ("plan_version"."price_amount" >= 0),
	CONSTRAINT "plan_version_price_currency_check" CHECK ("plan_version"."price_currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "plan_version_plan_fk" FOREIGN KEY ("plan_id") REFERENCES "plan"("id") ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "plan_version_status_idx" ON "plan_version" USING btree ("status");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "entitlement_definition" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" varchar(128) NOT NULL,
	"name" varchar(255) NOT NULL,
	"description" text,
	"value_type" varchar(32) NOT NULL,
	"unit" varchar(64),
	"created_at" timestamptz DEFAULT now() NOT NULL,
	"updated_at" timestamptz DEFAULT now() NOT NULL,
	CONSTRAINT "entitlement_definition_key_unique" UNIQUE ("key"),
	CONSTRAINT "entitlement_definition_value_type_check" CHECK ("entitlement_definition"."value_type" in ('boolean', 'static', 'metered'))
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "entitlement_definition_value_type_idx" ON "entitlement_definition" USING btree ("value_type");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "plan_entitlement" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"plan_version_id" uuid NOT NULL,
	"entitlement_definition_id" uuid NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"value" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamptz DEFAULT now() NOT NULL,
	"updated_at" timestamptz DEFAULT now() NOT NULL,
	CONSTRAINT "plan_entitlement_plan_version_definition_unique" UNIQUE ("plan_version_id", "entitlement_definition_id"),
	CONSTRAINT "plan_entitlement_plan_version_fk" FOREIGN KEY ("plan_version_id") REFERENCES "plan_version"("id") ON DELETE cascade,
	CONSTRAINT "plan_entitlement_definition_fk" FOREIGN KEY ("entitlement_definition_id") REFERENCES "entitlement_definition"("id") ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "plan_entitlement_definition_id_idx" ON "plan_entitlement" USING btree ("entitlement_definition_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "subscription" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"billing_account_id" uuid NOT NULL,
	"plan_version_id" uuid NOT NULL,
	"next_plan_version_id" uuid,
	"provider_connection_id" uuid,
	"provider_subscription_ref" varchar(255),
	"version" integer DEFAULT 1 NOT NULL,
	"status" varchar(32) NOT NULL,
	"starts_at" timestamptz DEFAULT now() NOT NULL,
	"current_period_start" timestamptz,
	"current_period_end" timestamptz,
	"cancel_at" timestamptz,
	"canceled_at" timestamptz,
	"ended_at" timestamptz,
	"created_at" timestamptz DEFAULT now() NOT NULL,
	"updated_at" timestamptz DEFAULT now() NOT NULL,
	CONSTRAINT "subscription_status_check" CHECK ("subscription"."status" in ('trialing', 'pending_payment', 'active', 'grace', 'restricted', 'suspended', 'canceling', 'canceled', 'expired')),
	CONSTRAINT "subscription_period_check" CHECK (("subscription"."current_period_start" is null and "subscription"."current_period_end" is null) or ("subscription"."current_period_start" is not null and "subscription"."current_period_end" is not null and "subscription"."current_period_end" > "subscription"."current_period_start")),
	CONSTRAINT "subscription_version_check" CHECK ("subscription"."version" > 0),
	CONSTRAINT "subscription_account_fk" FOREIGN KEY ("billing_account_id") REFERENCES "billing_account"("id") ON DELETE cascade,
	CONSTRAINT "subscription_plan_version_fk" FOREIGN KEY ("plan_version_id") REFERENCES "plan_version"("id") ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "subscription_account_status_idx" ON "subscription" USING btree ("billing_account_id", "status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "subscription_period_end_idx" ON "subscription" USING btree ("current_period_end");
--> statement-breakpoint
DO $$
DECLARE
  duplicate_current_subscription_count integer;
BEGIN
  SELECT count(*)
    INTO duplicate_current_subscription_count
    FROM (
      SELECT billing_account_id
      FROM subscription
      WHERE status in ('trialing', 'active', 'grace', 'canceling')
      GROUP BY billing_account_id
      HAVING count(*) > 1
    ) duplicates;

  IF duplicate_current_subscription_count > 0 THEN
    RAISE EXCEPTION
      'cannot add subscription current uniqueness: % billing account(s) have duplicate current subscriptions; no data was removed',
      duplicate_current_subscription_count;
  END IF;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "subscription_account_current_unique"
  ON "subscription" USING btree ("billing_account_id")
  WHERE "subscription"."status" in ('trialing', 'active', 'grace', 'canceling');
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "entitlement_grant" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"billing_account_id" uuid NOT NULL,
	"entitlement_definition_id" uuid NOT NULL,
	"source_type" varchar(32) NOT NULL,
	"source_ref" varchar(255),
	"value" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" varchar(32) DEFAULT 'active' NOT NULL,
	"starts_at" timestamptz DEFAULT now() NOT NULL,
	"ends_at" timestamptz,
	"revoked_at" timestamptz,
	"created_at" timestamptz DEFAULT now() NOT NULL,
	"updated_at" timestamptz DEFAULT now() NOT NULL,
	CONSTRAINT "entitlement_grant_source_type_check" CHECK ("entitlement_grant"."source_type" in ('subscription', 'manual', 'promotion', 'system')),
	CONSTRAINT "entitlement_grant_status_check" CHECK ("entitlement_grant"."status" in ('active', 'revoked', 'expired')),
	CONSTRAINT "entitlement_grant_period_check" CHECK ("entitlement_grant"."ends_at" is null or "entitlement_grant"."ends_at" > "entitlement_grant"."starts_at"),
	CONSTRAINT "entitlement_grant_account_fk" FOREIGN KEY ("billing_account_id") REFERENCES "billing_account"("id") ON DELETE cascade,
	CONSTRAINT "entitlement_grant_definition_fk" FOREIGN KEY ("entitlement_definition_id") REFERENCES "entitlement_definition"("id") ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "entitlement_grant_account_status_idx" ON "entitlement_grant" USING btree ("billing_account_id", "status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "entitlement_grant_definition_idx" ON "entitlement_grant" USING btree ("entitlement_definition_id");
--> statement-breakpoint
ALTER TABLE "entitlement_grant" ADD COLUMN IF NOT EXISTS "scope" varchar(32) DEFAULT 'account' NOT NULL;
--> statement-breakpoint
ALTER TABLE "entitlement_grant" ADD COLUMN IF NOT EXISTS "scope_id" uuid;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "entitlement_grant_scope_idx" ON "entitlement_grant" USING btree ("scope", "scope_id");
--> statement-breakpoint
ALTER TABLE "entitlement_grant" ADD CONSTRAINT "entitlement_grant_scope_check" CHECK ("entitlement_grant"."scope" in ('account', 'website', 'workspace', 'session', 'production'));
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "operation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"billing_account_id" uuid NOT NULL,
	"website_id" uuid,
	"type" varchar(64) NOT NULL,
	"status" varchar(32) DEFAULT 'pending' NOT NULL,
	"idempotency_key" varchar(255) NOT NULL,
	"request_hash" varchar(64),
	"request_id" varchar(255),
	"result_resource_id" uuid,
	"retry_count" integer DEFAULT 0 NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"error_code" varchar(128),
	"error_message" text,
	"started_at" timestamptz,
	"finished_at" timestamptz,
	"created_at" timestamptz DEFAULT now() NOT NULL,
	"updated_at" timestamptz DEFAULT now() NOT NULL,
	CONSTRAINT "operation_account_type_idempotency_unique" UNIQUE ("billing_account_id", "type", "idempotency_key"),
	CONSTRAINT "operation_type_check" CHECK ("operation"."type" <> ''),
	CONSTRAINT "operation_status_check" CHECK ("operation"."status" in ('pending', 'running', 'succeeded', 'failed', 'retryable', 'cancelled', 'expired')),
	CONSTRAINT "operation_finished_at_check" CHECK (("operation"."status" in ('pending', 'running', 'retryable') and "operation"."finished_at" is null) or ("operation"."status" in ('succeeded', 'failed', 'cancelled', 'expired') and "operation"."finished_at" is not null)),
	CONSTRAINT "operation_account_fk" FOREIGN KEY ("billing_account_id") REFERENCES "billing_account"("id") ON DELETE cascade,
	CONSTRAINT "operation_website_fk" FOREIGN KEY ("website_id") REFERENCES "website"("id") ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "operation_account_status_idx" ON "operation" USING btree ("billing_account_id", "status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "operation_website_id_idx" ON "operation" USING btree ("website_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "quota_reservation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"billing_account_id" uuid NOT NULL,
	"operation_id" uuid NOT NULL,
	"entitlement_definition_id" uuid NOT NULL,
	"dimension" varchar(128) DEFAULT '' NOT NULL,
	"quantity" numeric(30, 0) NOT NULL,
	"status" varchar(32) DEFAULT 'reserved' NOT NULL,
	"expires_at" timestamptz NOT NULL,
	"committed_at" timestamptz,
	"released_at" timestamptz,
	"created_at" timestamptz DEFAULT now() NOT NULL,
	"updated_at" timestamptz DEFAULT now() NOT NULL,
	CONSTRAINT "quota_reservation_operation_definition_dimension_unique" UNIQUE ("operation_id", "entitlement_definition_id", "dimension"),
	CONSTRAINT "quota_reservation_quantity_check" CHECK ("quota_reservation"."quantity" > 0),
	CONSTRAINT "quota_reservation_status_check" CHECK ("quota_reservation"."status" in ('reserved', 'committed', 'released', 'expired')),
	CONSTRAINT "quota_reservation_account_fk" FOREIGN KEY ("billing_account_id") REFERENCES "billing_account"("id") ON DELETE cascade,
	CONSTRAINT "quota_reservation_operation_fk" FOREIGN KEY ("operation_id") REFERENCES "operation"("id") ON DELETE cascade,
	CONSTRAINT "quota_reservation_definition_fk" FOREIGN KEY ("entitlement_definition_id") REFERENCES "entitlement_definition"("id") ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "quota_reservation_account_status_idx" ON "quota_reservation" USING btree ("billing_account_id", "status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "quota_reservation_expiry_idx" ON "quota_reservation" USING btree ("status", "expires_at");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "usage_event" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"billing_account_id" uuid NOT NULL,
	"entitlement_definition_id" uuid NOT NULL,
	"website_id" uuid,
	"workspace_id" uuid,
	"website_session_id" uuid,
	"agent_run_id" uuid,
	"operation_id" uuid,
	"quantity" numeric(30, 0) NOT NULL,
	"dimension" varchar(128) DEFAULT '' NOT NULL,
	"source" varchar(64) NOT NULL,
	"idempotency_key" varchar(255) NOT NULL,
	"occurred_at" timestamptz NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamptz DEFAULT now() NOT NULL,
	CONSTRAINT "usage_event_account_source_idempotency_unique" UNIQUE ("billing_account_id", "source", "idempotency_key"),
	CONSTRAINT "usage_event_quantity_check" CHECK ("usage_event"."quantity" <> 0),
	CONSTRAINT "usage_event_source_check" CHECK ("usage_event"."source" <> ''),
	CONSTRAINT "usage_event_account_fk" FOREIGN KEY ("billing_account_id") REFERENCES "billing_account"("id") ON DELETE cascade,
	CONSTRAINT "usage_event_definition_fk" FOREIGN KEY ("entitlement_definition_id") REFERENCES "entitlement_definition"("id") ON DELETE restrict,
	CONSTRAINT "usage_event_website_fk" FOREIGN KEY ("website_id") REFERENCES "website"("id") ON DELETE set null,
	CONSTRAINT "usage_event_workspace_fk" FOREIGN KEY ("workspace_id") REFERENCES "workspace"("id") ON DELETE set null,
	CONSTRAINT "usage_event_session_fk" FOREIGN KEY ("website_session_id") REFERENCES "website_session"("id") ON DELETE set null,
	CONSTRAINT "usage_event_agent_run_fk" FOREIGN KEY ("agent_run_id") REFERENCES "agent_run"("id") ON DELETE set null,
	CONSTRAINT "usage_event_operation_fk" FOREIGN KEY ("operation_id") REFERENCES "operation"("id") ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "usage_event_account_definition_occurred_idx" ON "usage_event" USING btree ("billing_account_id", "entitlement_definition_id", "occurred_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "usage_event_website_occurred_idx" ON "usage_event" USING btree ("website_id", "occurred_at");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "usage_aggregate" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"billing_account_id" uuid NOT NULL,
	"entitlement_definition_id" uuid NOT NULL,
	"period_start" timestamptz NOT NULL,
	"period_end" timestamptz NOT NULL,
	"dimension" varchar(128) DEFAULT '' NOT NULL,
	"total_quantity" numeric(30, 0) DEFAULT 0 NOT NULL,
	"event_count" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamptz DEFAULT now() NOT NULL,
	CONSTRAINT "usage_aggregate_account_definition_period_dimension_unique" UNIQUE ("billing_account_id", "entitlement_definition_id", "period_start", "period_end", "dimension"),
	CONSTRAINT "usage_aggregate_period_check" CHECK ("usage_aggregate"."period_end" > "usage_aggregate"."period_start"),
	CONSTRAINT "usage_aggregate_quantity_check" CHECK ("usage_aggregate"."total_quantity" >= 0),
	CONSTRAINT "usage_aggregate_event_count_check" CHECK ("usage_aggregate"."event_count" >= 0),
	CONSTRAINT "usage_aggregate_account_fk" FOREIGN KEY ("billing_account_id") REFERENCES "billing_account"("id") ON DELETE cascade,
	CONSTRAINT "usage_aggregate_definition_fk" FOREIGN KEY ("entitlement_definition_id") REFERENCES "entitlement_definition"("id") ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "usage_aggregate_period_idx" ON "usage_aggregate" USING btree ("period_start", "period_end");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "provider_connection" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"billing_account_id" uuid NOT NULL,
	"provider_key" varchar(64) NOT NULL,
	"environment" varchar(32) DEFAULT 'live' NOT NULL,
	"status" varchar(32) DEFAULT 'active' NOT NULL,
	"credential_ref" varchar(255),
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamptz DEFAULT now() NOT NULL,
	"updated_at" timestamptz DEFAULT now() NOT NULL,
	CONSTRAINT "provider_connection_account_provider_environment_unique" UNIQUE ("billing_account_id", "provider_key", "environment"),
	CONSTRAINT "provider_connection_provider_key_check" CHECK ("provider_connection"."provider_key" <> ''),
	CONSTRAINT "provider_connection_environment_check" CHECK ("provider_connection"."environment" in ('test', 'live')),
	CONSTRAINT "provider_connection_status_check" CHECK ("provider_connection"."status" in ('active', 'disabled')),
	CONSTRAINT "provider_connection_account_fk" FOREIGN KEY ("billing_account_id") REFERENCES "billing_account"("id") ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "provider_connection_provider_status_idx" ON "provider_connection" USING btree ("provider_key", "status");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "provider_external_reference" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider_connection_id" uuid NOT NULL,
	"resource_type" varchar(64) NOT NULL,
	"external_id" varchar(255) NOT NULL,
	"local_resource_type" varchar(64) NOT NULL,
	"local_resource_id" uuid NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamptz DEFAULT now() NOT NULL,
	"updated_at" timestamptz DEFAULT now() NOT NULL,
	CONSTRAINT "provider_external_reference_external_unique" UNIQUE ("provider_connection_id", "resource_type", "external_id"),
	CONSTRAINT "provider_external_reference_local_unique" UNIQUE ("provider_connection_id", "local_resource_type", "local_resource_id"),
	CONSTRAINT "provider_external_reference_connection_fk" FOREIGN KEY ("provider_connection_id") REFERENCES "provider_connection"("id") ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "provider_external_reference_local_lookup_idx" ON "provider_external_reference" USING btree ("local_resource_type", "local_resource_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "provider_event_inbox" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider_connection_id" uuid NOT NULL,
	"provider_event_id" varchar(255) NOT NULL,
	"event_type" varchar(128) NOT NULL,
	"signature_verified" boolean DEFAULT false NOT NULL,
	"payload" jsonb NOT NULL,
	"payload_sha256" varchar(64) NOT NULL,
	"status" varchar(32) DEFAULT 'received' NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"received_at" timestamptz DEFAULT now() NOT NULL,
	"next_attempt_at" timestamptz,
	"processed_at" timestamptz,
	"created_at" timestamptz DEFAULT now() NOT NULL,
	CONSTRAINT "provider_event_inbox_connection_event_unique" UNIQUE ("provider_connection_id", "provider_event_id"),
	CONSTRAINT "provider_event_inbox_event_id_check" CHECK ("provider_event_inbox"."provider_event_id" <> ''),
	CONSTRAINT "provider_event_inbox_event_type_check" CHECK ("provider_event_inbox"."event_type" <> ''),
	CONSTRAINT "provider_event_inbox_status_check" CHECK ("provider_event_inbox"."status" in ('received', 'processing', 'processed', 'failed', 'ignored')),
	CONSTRAINT "provider_event_inbox_attempt_count_check" CHECK ("provider_event_inbox"."attempt_count" >= 0),
	CONSTRAINT "provider_event_inbox_payload_sha256_check" CHECK ("provider_event_inbox"."payload_sha256" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "provider_event_inbox_connection_fk" FOREIGN KEY ("provider_connection_id") REFERENCES "provider_connection"("id") ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "provider_event_inbox_status_retry_idx" ON "provider_event_inbox" USING btree ("status", "next_attempt_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "provider_event_inbox_received_at_idx" ON "provider_event_inbox" USING btree ("received_at");
--> statement-breakpoint
ALTER TABLE "subscription" ADD CONSTRAINT "subscription_next_plan_version_fk" FOREIGN KEY ("next_plan_version_id") REFERENCES "plan_version"("id") ON DELETE RESTRICT;
ALTER TABLE "subscription" ADD CONSTRAINT "subscription_provider_connection_fk" FOREIGN KEY ("provider_connection_id") REFERENCES "provider_connection"("id") ON DELETE RESTRICT;
--> statement-breakpoint
ALTER TABLE "subscription" DROP CONSTRAINT IF EXISTS "subscription_account_fk";
ALTER TABLE "subscription" ADD CONSTRAINT "subscription_account_fk" FOREIGN KEY ("billing_account_id") REFERENCES "billing_account"("id") ON DELETE RESTRICT;
--> statement-breakpoint
ALTER TABLE "entitlement_grant" DROP CONSTRAINT IF EXISTS "entitlement_grant_account_fk";
ALTER TABLE "entitlement_grant" ADD CONSTRAINT "entitlement_grant_account_fk" FOREIGN KEY ("billing_account_id") REFERENCES "billing_account"("id") ON DELETE RESTRICT;
--> statement-breakpoint
ALTER TABLE "operation" DROP CONSTRAINT IF EXISTS "operation_account_fk";
ALTER TABLE "operation" ADD CONSTRAINT "operation_account_fk" FOREIGN KEY ("billing_account_id") REFERENCES "billing_account"("id") ON DELETE RESTRICT;
--> statement-breakpoint
ALTER TABLE "quota_reservation" DROP CONSTRAINT IF EXISTS "quota_reservation_account_fk";
ALTER TABLE "quota_reservation" ADD CONSTRAINT "quota_reservation_account_fk" FOREIGN KEY ("billing_account_id") REFERENCES "billing_account"("id") ON DELETE RESTRICT;
--> statement-breakpoint
ALTER TABLE "usage_event" DROP CONSTRAINT IF EXISTS "usage_event_account_fk";
ALTER TABLE "usage_event" ADD CONSTRAINT "usage_event_account_fk" FOREIGN KEY ("billing_account_id") REFERENCES "billing_account"("id") ON DELETE RESTRICT;
--> statement-breakpoint
ALTER TABLE "usage_aggregate" DROP CONSTRAINT IF EXISTS "usage_aggregate_account_fk";
ALTER TABLE "usage_aggregate" ADD CONSTRAINT "usage_aggregate_account_fk" FOREIGN KEY ("billing_account_id") REFERENCES "billing_account"("id") ON DELETE RESTRICT;
--> statement-breakpoint
ALTER TABLE "provider_connection" DROP CONSTRAINT IF EXISTS "provider_connection_account_fk";
ALTER TABLE "provider_connection" ADD CONSTRAINT "provider_connection_account_fk" FOREIGN KEY ("billing_account_id") REFERENCES "billing_account"("id") ON DELETE RESTRICT;
--> statement-breakpoint
ALTER TABLE "billing_account_member" DROP CONSTRAINT IF EXISTS "billing_account_member_account_fk";
ALTER TABLE "billing_account_member" ADD CONSTRAINT "billing_account_member_account_fk" FOREIGN KEY ("billing_account_id") REFERENCES "billing_account"("id") ON DELETE RESTRICT;
--> statement-breakpoint
ALTER TABLE "provider_external_reference" DROP CONSTRAINT IF EXISTS "provider_external_reference_connection_fk";
ALTER TABLE "provider_external_reference" ADD CONSTRAINT "provider_external_reference_connection_fk" FOREIGN KEY ("provider_connection_id") REFERENCES "provider_connection"("id") ON DELETE RESTRICT;
--> statement-breakpoint
ALTER TABLE "provider_event_inbox" DROP CONSTRAINT IF EXISTS "provider_event_inbox_connection_fk";
ALTER TABLE "provider_event_inbox" ADD CONSTRAINT "provider_event_inbox_connection_fk" FOREIGN KEY ("provider_connection_id") REFERENCES "provider_connection"("id") ON DELETE RESTRICT;
--> statement-breakpoint
ALTER TABLE "conversation_attachment" DROP CONSTRAINT IF EXISTS "conversation_attachment_status_check";
ALTER TABLE "conversation_attachment" ADD CONSTRAINT "conversation_attachment_status_check" CHECK ("conversation_attachment"."status" in ('uploading', 'ready', 'failed', 'deleting', 'deleted'));
