-- Set model max context length default to 32000 and backfill existing rows.

ALTER TABLE "models"
  ALTER COLUMN "max_context_length" SET DEFAULT 32000;

UPDATE "models"
SET "max_context_length" = 32000
WHERE "max_context_length" IS DISTINCT FROM 32000;
