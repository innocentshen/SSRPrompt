-- Query optimization indexes for evaluation list, queue recovery, and run progress.

CREATE INDEX IF NOT EXISTS "evaluations_user_id_order_index_created_at_idx"
  ON "evaluations"("user_id", "order_index", "created_at" DESC);

CREATE INDEX IF NOT EXISTS "evaluations_is_public_order_index_created_at_idx"
  ON "evaluations"("is_public", "order_index", "created_at" DESC);

CREATE INDEX IF NOT EXISTS "evaluation_import_jobs_status_created_at_idx"
  ON "evaluation_import_jobs"("status", "created_at");

CREATE INDEX IF NOT EXISTS "evaluation_runs_evaluation_id_created_at_idx"
  ON "evaluation_runs"("evaluation_id", "created_at" DESC);

CREATE INDEX IF NOT EXISTS "evaluation_runs_status_created_at_idx"
  ON "evaluation_runs"("status", "created_at");

CREATE INDEX IF NOT EXISTS "test_case_results_run_id_passed_idx"
  ON "test_case_results"("run_id", "passed");
