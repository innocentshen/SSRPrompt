-- Evaluation analysis reports for single/multi run insights.

-- CreateEnum
CREATE TYPE "EvaluationAnalysisScope" AS ENUM ('single', 'multi');

-- CreateTable
CREATE TABLE "evaluation_analysis_reports" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "evaluation_id" TEXT NOT NULL,
    "scope" "EvaluationAnalysisScope" NOT NULL,
    "title" TEXT,
    "run_ids" JSONB NOT NULL DEFAULT '[]',
    "analysis_model_id" TEXT NOT NULL,
    "analysis_model_name" TEXT,
    "prompt_text" TEXT NOT NULL,
    "analysis_data" JSONB NOT NULL DEFAULT '{}',
    "summary_markdown" TEXT NOT NULL,
    "locale" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "evaluation_analysis_reports_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "evaluation_analysis_reports_user_id_evaluation_id_created_at_idx"
ON "evaluation_analysis_reports"("user_id" ASC, "evaluation_id" ASC, "created_at" DESC);

-- CreateIndex
CREATE INDEX "evaluation_analysis_reports_evaluation_id_created_at_idx"
ON "evaluation_analysis_reports"("evaluation_id" ASC, "created_at" DESC);

-- AddForeignKey
ALTER TABLE "evaluation_analysis_reports"
ADD CONSTRAINT "evaluation_analysis_reports_user_id_fkey"
FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evaluation_analysis_reports"
ADD CONSTRAINT "evaluation_analysis_reports_evaluation_id_fkey"
FOREIGN KEY ("evaluation_id") REFERENCES "evaluations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
