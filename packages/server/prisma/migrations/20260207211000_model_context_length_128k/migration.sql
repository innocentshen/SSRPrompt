-- Set model max context length default to 128000 and backfill existing rows.

ALTER TABLE "models"
  ALTER COLUMN "max_context_length" SET DEFAULT 128000;

UPDATE "models"
SET "max_context_length" = 128000
WHERE "max_context_length" IS DISTINCT FROM 128000;
