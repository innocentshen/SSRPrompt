/*
  # Add messages and config columns to prompts table

  1. Changes
    - Add `messages` column (jsonb) to prompts table for multi-turn conversation
    - Add `config` column (jsonb) to prompts table for model parameters

  2. Notes
    - These columns are required by the frontend for prompt configuration
    - Default values ensure backwards compatibility with existing data
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'prompts' AND column_name = 'messages'
  ) THEN
    ALTER TABLE prompts ADD COLUMN messages jsonb DEFAULT '[]';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'prompts' AND column_name = 'config'
  ) THEN
    ALTER TABLE prompts ADD COLUMN config jsonb DEFAULT '{}';
  END IF;
END $$;
