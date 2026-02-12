-- Private share links for prompts and evaluations.

-- CreateEnum
CREATE TYPE "ShareResourceType" AS ENUM ('prompt', 'evaluation');

-- CreateEnum
CREATE TYPE "ShareAccessAction" AS ENUM (
  'view',
  'copy',
  'download_attachment',
  'password_success',
  'password_failure'
);

-- CreateTable
CREATE TABLE "share_links" (
  "id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "resource_type" "ShareResourceType" NOT NULL,
  "resource_id" TEXT NOT NULL,
  "token" TEXT NOT NULL,
  "password_hash" TEXT,
  "allow_copy" BOOLEAN NOT NULL DEFAULT true,
  "expires_at" TIMESTAMP(3),
  "revoked_at" TIMESTAMP(3),
  "access_count" INTEGER NOT NULL DEFAULT 0,
  "last_accessed_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "share_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "share_link_password_grants" (
  "id" TEXT NOT NULL,
  "share_link_id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "granted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expires_at" TIMESTAMP(3),

  CONSTRAINT "share_link_password_grants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "share_link_access_logs" (
  "id" TEXT NOT NULL,
  "share_link_id" TEXT NOT NULL,
  "accessor_user_id" TEXT,
  "action" "ShareAccessAction" NOT NULL,
  "ip_address" TEXT,
  "user_agent" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "share_link_access_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "share_links_token_key" ON "share_links"("token");

-- CreateIndex
CREATE INDEX "share_links_user_id_created_at_idx" ON "share_links"("user_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "share_links_resource_type_resource_id_idx" ON "share_links"("resource_type", "resource_id");

-- CreateIndex
CREATE INDEX "share_links_token_idx" ON "share_links"("token");

-- CreateIndex
CREATE INDEX "share_links_revoked_at_idx" ON "share_links"("revoked_at");

-- CreateIndex
CREATE UNIQUE INDEX "share_link_password_grants_share_link_id_user_id_key" ON "share_link_password_grants"("share_link_id", "user_id");

-- CreateIndex
CREATE INDEX "share_link_password_grants_user_id_idx" ON "share_link_password_grants"("user_id");

-- CreateIndex
CREATE INDEX "share_link_password_grants_expires_at_idx" ON "share_link_password_grants"("expires_at");

-- CreateIndex
CREATE INDEX "share_link_access_logs_share_link_id_created_at_idx" ON "share_link_access_logs"("share_link_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "share_link_access_logs_accessor_user_id_idx" ON "share_link_access_logs"("accessor_user_id");

-- CreateIndex
CREATE INDEX "share_link_access_logs_action_idx" ON "share_link_access_logs"("action");

-- AddForeignKey
ALTER TABLE "share_links"
ADD CONSTRAINT "share_links_user_id_fkey"
FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "share_link_password_grants"
ADD CONSTRAINT "share_link_password_grants_share_link_id_fkey"
FOREIGN KEY ("share_link_id") REFERENCES "share_links"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "share_link_password_grants"
ADD CONSTRAINT "share_link_password_grants_user_id_fkey"
FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "share_link_access_logs"
ADD CONSTRAINT "share_link_access_logs_share_link_id_fkey"
FOREIGN KEY ("share_link_id") REFERENCES "share_links"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "share_link_access_logs"
ADD CONSTRAINT "share_link_access_logs_accessor_user_id_fkey"
FOREIGN KEY ("accessor_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

