-- Add OCR latency tracking to evaluation test case results
ALTER TABLE "test_case_results" ADD COLUMN "ocr_latency_ms" INTEGER NOT NULL DEFAULT 0;

