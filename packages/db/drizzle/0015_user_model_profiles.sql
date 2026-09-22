CREATE TABLE IF NOT EXISTS "user_model_profile" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"provider_kind" varchar(32) NOT NULL,
	"provider_id" varchar(128) NOT NULL,
	"model_id" varchar(255) NOT NULL,
	"display_name" varchar(255) NOT NULL,
	"base_url" text,
	"api" varchar(64),
	"api_key_ciphertext" text NOT NULL,
	"api_key_iv" varchar(32) NOT NULL,
	"api_key_auth_tag" varchar(32) NOT NULL,
	"encryption_key_version" varchar(32) NOT NULL,
	"key_hint" varchar(16) NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_model_profile_provider_kind_check" CHECK ("user_model_profile"."provider_kind" in ('builtin', 'openai-compatible')),
	CONSTRAINT "user_model_profile_key_hint_check" CHECK ("user_model_profile"."key_hint" <> '')
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "user_model_profile" ADD CONSTRAINT "user_model_profile_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_model_profile_user_id_idx" ON "user_model_profile" USING btree ("user_id");
