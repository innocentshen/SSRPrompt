-- Add order_index to evaluations for custom ordering.

-- AlterTable
ALTER TABLE "evaluations"
ADD COLUMN IF NOT EXISTS "order_index" INTEGER NOT NULL DEFAULT 0;

-- Backfill order_index per user to preserve created_at ordering (desc).
WITH ranked AS (
  SELECT
    id,
    ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY created_at DESC) - 1 AS order_index
  FROM evaluations
)
UPDATE evaluations AS e
SET order_index = ranked.order_index
FROM ranked
WHERE e.id = ranked.id
  AND e.order_index = 0;
