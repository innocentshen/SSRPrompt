-- CreateEnum
CREATE TYPE "OcrProvider" AS ENUM ('paddle', 'datalab');

-- CreateEnum
CREATE TYPE "OcrCredentialSource" AS ENUM ('system', 'custom');

-- CreateEnum
CREATE TYPE "OcrStatus" AS ENUM ('success', 'failed');

-- AlterTable
ALTER TABLE "models" ADD COLUMN     "max_context_length" INTEGER NOT NULL DEFAULT 8000,
ALTER COLUMN "supports_vision" SET DEFAULT false;

-- CreateTable
CREATE TABLE "files" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "original_name" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "bucket" TEXT NOT NULL,
    "object_key" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "files_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ocr_provider_settings" (
    "user_id" TEXT NOT NULL,
    "ocr_enabled" BOOLEAN NOT NULL DEFAULT false,
    "selected_provider" "OcrProvider" NOT NULL DEFAULT 'paddle',
    "credential_source" "OcrCredentialSource" NOT NULL DEFAULT 'system',
    "base_url" TEXT,
    "api_key_encrypted" TEXT,
    "api_key_last4" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ocr_provider_settings_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "ocr_system_provider_configs" (
    "provider" "OcrProvider" NOT NULL,
    "base_url" TEXT,
    "api_key_encrypted" TEXT,
    "api_key_last4" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ocr_system_provider_configs_pkey" PRIMARY KEY ("provider")
);

-- CreateTable
CREATE TABLE "ocr_results" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "file_id" TEXT NOT NULL,
    "provider" "OcrProvider" NOT NULL,
    "status" "OcrStatus" NOT NULL DEFAULT 'success',
    "error_message" TEXT,
    "full_text" TEXT NOT NULL,
    "pages_json" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ocr_results_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "files_user_id_idx" ON "files"("user_id");

-- CreateIndex
CREATE INDEX "files_sha256_idx" ON "files"("sha256");

-- CreateIndex
CREATE INDEX "ocr_results_user_id_idx" ON "ocr_results"("user_id");

-- CreateIndex
CREATE INDEX "ocr_results_file_id_idx" ON "ocr_results"("file_id");

-- CreateIndex
CREATE INDEX "ocr_results_provider_idx" ON "ocr_results"("provider");

-- CreateIndex
CREATE UNIQUE INDEX "ocr_results_user_id_file_id_provider_key" ON "ocr_results"("user_id", "file_id", "provider");

-- AddForeignKey
ALTER TABLE "files" ADD CONSTRAINT "files_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ocr_provider_settings" ADD CONSTRAINT "ocr_provider_settings_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ocr_results" ADD CONSTRAINT "ocr_results_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ocr_results" ADD CONSTRAINT "ocr_results_file_id_fkey" FOREIGN KEY ("file_id") REFERENCES "files"("id") ON DELETE CASCADE ON UPDATE CASCADE;
