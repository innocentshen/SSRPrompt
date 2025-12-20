/*
  # Add token statistics to evaluation runs

  1. Changes
    - Add `total_tokens_input` column to `evaluation_runs` table
    - Add `total_tokens_output` column to `evaluation_runs` table
    - These columns will store the total token consumption for each evaluation run

  2. Notes
    - Both columns default to 0 for backwards compatibility with existing runs
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'evaluation_runs' AND column_name = 'total_tokens_input'
  ) THEN
    ALTER TABLE evaluation_runs ADD COLUMN total_tokens_input integer DEFAULT 0;
  END IF;
  
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'evaluation_runs' AND column_name = 'total_tokens_output'
  ) THEN
    ALTER TABLE evaluation_runs ADD COLUMN total_tokens_output integer DEFAULT 0;
  END IF;
END $$;