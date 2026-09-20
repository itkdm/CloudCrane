ALTER TABLE "website" ADD COLUMN IF NOT EXISTS "preview_slug" varchar(12);
CREATE UNIQUE INDEX IF NOT EXISTS "website_preview_slug_unique" ON "website" ("preview_slug");
