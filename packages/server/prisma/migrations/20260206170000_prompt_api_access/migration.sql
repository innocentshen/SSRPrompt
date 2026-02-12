-- Prompt API access and API key management.

-- CreateEnum
CREATE TYPE "PromptApiVersionMode" AS ENUM ('latest', 'fixed');

-- AlterTable
ALTER TABLE "prompts"
  ADD COLUMN "api_enabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "api_version_mode" "PromptApiVersionMode" NOT NULL DEFAULT 'latest',
  ADD COLUMN "api_fixed_version" INTEGER;

-- CreateTable
CREATE TABLE "prompt_api_keys" (
  "id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "key_hash" TEXT NOT NULL,
  "key_prefix" TEXT NOT NULL,
  "key_last4" TEXT NOT NULL,
  "expires_at" TIMESTAMP(3),
  "last_used_at" TIMESTAMP(3),
  "revoked_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "prompt_api_keys_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "prompt_api_keys_key_hash_key" ON "prompt_api_keys"("key_hash");

-- CreateIndex
CREATE INDEX "prompt_api_keys_user_id_created_at_idx" ON "prompt_api_keys"("user_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "prompt_api_keys_key_prefix_idx" ON "prompt_api_keys"("key_prefix");

-- CreateIndex
CREATE INDEX "prompt_api_keys_expires_at_idx" ON "prompt_api_keys"("expires_at");

-- CreateIndex
CREATE INDEX "prompt_api_keys_revoked_at_idx" ON "prompt_api_keys"("revoked_at");

-- AddForeignKey
ALTER TABLE "prompt_api_keys"
ADD CONSTRAINT "prompt_api_keys_user_id_fkey"
FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
