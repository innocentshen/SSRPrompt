-- Allow evaluation owners to optionally share file attachments for public evaluations.

-- AlterTable
ALTER TABLE "evaluations"
ADD COLUMN IF NOT EXISTS "share_attachments" BOOLEAN NOT NULL DEFAULT false;

