-- Add model pricing fields (per 1M tokens).
-- Existing rows default to 0 for backward compatibility.

ALTER TABLE "models"
  ADD COLUMN "input_price_per_m" DECIMAL(18,8) NOT NULL DEFAULT 0,
  ADD COLUMN "output_price_per_m" DECIMAL(18,8) NOT NULL DEFAULT 0;

