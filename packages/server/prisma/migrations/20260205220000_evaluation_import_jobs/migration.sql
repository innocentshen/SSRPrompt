-- Evaluation import jobs (Excel + ZIP attachments).

-- CreateEnum
CREATE TYPE "EvaluationImportStatus" AS ENUM ('pending', 'running', 'completed', 'failed');

-- CreateEnum
CREATE TYPE "EvaluationImportMode" AS ENUM ('create', 'append', 'overwrite');

-- CreateTable
CREATE TABLE "evaluation_import_jobs" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "status" "EvaluationImportStatus" NOT NULL DEFAULT 'pending',
    "mode" "EvaluationImportMode" NOT NULL,
    "source_zip_file_id" TEXT NOT NULL,
    "target_evaluation_id" TEXT,
    "result_evaluation_id" TEXT,
    "progress" JSONB NOT NULL DEFAULT '{}',
    "errors" JSONB NOT NULL DEFAULT '[]',
    "error_message" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),

    CONSTRAINT "evaluation_import_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "evaluation_import_jobs_user_id_idx" ON "evaluation_import_jobs"("user_id" ASC);

-- CreateIndex
CREATE INDEX "evaluation_import_jobs_status_idx" ON "evaluation_import_jobs"("status" ASC);

-- CreateIndex
CREATE INDEX "evaluation_import_jobs_created_at_idx" ON "evaluation_import_jobs"("created_at" DESC);

-- AddForeignKey
ALTER TABLE "evaluation_import_jobs" ADD CONSTRAINT "evaluation_import_jobs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evaluation_import_jobs" ADD CONSTRAINT "evaluation_import_jobs_source_zip_file_id_fkey" FOREIGN KEY ("source_zip_file_id") REFERENCES "files"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evaluation_import_jobs" ADD CONSTRAINT "evaluation_import_jobs_target_evaluation_id_fkey" FOREIGN KEY ("target_evaluation_id") REFERENCES "evaluations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evaluation_import_jobs" ADD CONSTRAINT "evaluation_import_jobs_result_evaluation_id_fkey" FOREIGN KEY ("result_evaluation_id") REFERENCES "evaluations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

