-- AlterTable
ALTER TABLE "evaluation_runs" ADD COLUMN     "run_config" JSONB;

-- AlterTable
ALTER TABLE "prompts" ADD COLUMN     "group_id" TEXT;

-- CreateTable
CREATE TABLE "prompt_groups" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL DEFAULT 'default',
    "name" TEXT NOT NULL,
    "parent_id" TEXT,
    "order_index" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "prompt_groups_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "prompt_groups_user_id_idx" ON "prompt_groups"("user_id");

-- CreateIndex
CREATE INDEX "prompt_groups_parent_id_idx" ON "prompt_groups"("parent_id");

-- CreateIndex
CREATE INDEX "prompt_groups_order_index_idx" ON "prompt_groups"("order_index");

-- CreateIndex
CREATE INDEX "prompts_group_id_idx" ON "prompts"("group_id");

-- CreateIndex
CREATE INDEX "traces_user_id_created_at_idx" ON "traces"("user_id", "created_at" DESC);

-- AddForeignKey
ALTER TABLE "prompts" ADD CONSTRAINT "prompts_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "prompt_groups"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prompt_groups" ADD CONSTRAINT "prompt_groups_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prompt_groups" ADD CONSTRAINT "prompt_groups_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "prompt_groups"("id") ON DELETE SET NULL ON UPDATE CASCADE;
