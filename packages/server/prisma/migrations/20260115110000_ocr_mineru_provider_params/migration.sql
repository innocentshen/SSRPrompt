-- Add MinerU as a supported OCR provider and persist provider-specific request parameters.

-- AlterEnum
ALTER TYPE "OcrProvider" ADD VALUE IF NOT EXISTS 'paddle_vl';
ALTER TYPE "OcrProvider" ADD VALUE IF NOT EXISTS 'mineru';

-- AlterTable
ALTER TABLE "ocr_provider_settings"
ADD COLUMN IF NOT EXISTS "provider_params" JSONB NOT NULL DEFAULT '{}'::jsonb;
