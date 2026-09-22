ALTER TABLE "user_model_profile" ADD COLUMN "input" jsonb DEFAULT '["text"]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "user_model_profile" ADD COLUMN "reasoning" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "user_model_profile" ADD COLUMN "context_window" integer DEFAULT 128000 NOT NULL;--> statement-breakpoint
ALTER TABLE "user_model_profile" ADD COLUMN "max_tokens" integer DEFAULT 16384 NOT NULL;