-- CreateTable
CREATE TABLE "user_provider_settings" (
    "user_id" TEXT NOT NULL,
    "provider_id" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_provider_settings_pkey" PRIMARY KEY ("user_id", "provider_id")
);

-- CreateIndex
CREATE INDEX "user_provider_settings_provider_id_idx" ON "user_provider_settings"("provider_id");

-- AddForeignKey
ALTER TABLE "user_provider_settings" ADD CONSTRAINT "user_provider_settings_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_provider_settings" ADD CONSTRAINT "user_provider_settings_provider_id_fkey" FOREIGN KEY ("provider_id") REFERENCES "providers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
