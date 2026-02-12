-- Remove duplicate results per run/test-case pair, keep the latest row.
WITH ranked AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY run_id, test_case_id
      ORDER BY created_at DESC, id DESC
    ) AS row_num
  FROM test_case_results
  WHERE run_id IS NOT NULL
)
DELETE FROM test_case_results AS t
USING ranked AS r
WHERE t.id = r.id
  AND r.row_num > 1;

-- Enforce idempotency for run result writes.
CREATE UNIQUE INDEX "test_case_results_run_id_test_case_id_key"
  ON "test_case_results"("run_id", "test_case_id");
