-- Add trace source type to distinguish UI feature calls from Prompt API calls.

DO $$ BEGIN
  CREATE TYPE "TraceSource" AS ENUM ('feature', 'api');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

ALTER TABLE "traces"
  ADD COLUMN IF NOT EXISTS "source" "TraceSource" NOT NULL DEFAULT 'feature';

CREATE INDEX IF NOT EXISTS "traces_user_id_source_created_at_idx"
  ON "traces"("user_id", "source", "created_at" DESC);
