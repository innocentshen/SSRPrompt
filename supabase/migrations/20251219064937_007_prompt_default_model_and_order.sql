/*
  # Add Default Model and Order Index to Prompts

  1. Changes
    - Add `default_model_id` column to prompts table (references models)
    - Add `order_index` column to prompts table for manual ordering

  2. Security
    - No changes to RLS policies needed (existing policies cover new columns)
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'prompts' AND column_name = 'default_model_id'
  ) THEN
    ALTER TABLE prompts ADD COLUMN default_model_id uuid REFERENCES models(id) ON DELETE SET NULL;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'prompts' AND column_name = 'order_index'
  ) THEN
    ALTER TABLE prompts ADD COLUMN order_index integer DEFAULT 0;
  END IF;
END $$;