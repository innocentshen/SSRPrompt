-- Add multimodal OCR provider and make OCR cache key depend on provider config.
ALTER TYPE "OcrProvider" ADD VALUE 'multimodal_model';

ALTER TABLE "ocr_results"
ADD COLUMN "config_hash" TEXT NOT NULL DEFAULT '';

DROP INDEX "ocr_results_user_id_file_id_provider_key";

CREATE INDEX "ocr_results_config_hash_idx" ON "ocr_results"("config_hash");

CREATE UNIQUE INDEX "ocr_results_user_id_file_id_provider_config_hash_key"
ON "ocr_results"("user_id", "file_id", "provider", "config_hash");
