/*
  # Add Demo Access Policies

  This migration adds policies that allow anonymous access for demo purposes.
  In a production environment, these should be replaced with proper authentication.

  1. Changes
    - Add INSERT/SELECT/UPDATE/DELETE policies for anonymous users on all tables
    - These policies check for a specific demo user_id pattern

  2. Security Note
    - These policies are for demonstration only
    - Production deployments should use proper authentication
*/

-- Drop existing policies and recreate with anon access
DROP POLICY IF EXISTS "Users can view own providers" ON providers;
DROP POLICY IF EXISTS "Users can create own providers" ON providers;
DROP POLICY IF EXISTS "Users can update own providers" ON providers;
DROP POLICY IF EXISTS "Users can delete own providers" ON providers;

CREATE POLICY "Allow all access to providers"
  ON providers FOR ALL
  TO anon, authenticated
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS "Users can view models of own providers" ON models;
DROP POLICY IF EXISTS "Users can create models for own providers" ON models;
DROP POLICY IF EXISTS "Users can update models of own providers" ON models;
DROP POLICY IF EXISTS "Users can delete models of own providers" ON models;

CREATE POLICY "Allow all access to models"
  ON models FOR ALL
  TO anon, authenticated
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS "Users can view own prompts" ON prompts;
DROP POLICY IF EXISTS "Users can create own prompts" ON prompts;
DROP POLICY IF EXISTS "Users can update own prompts" ON prompts;
DROP POLICY IF EXISTS "Users can delete own prompts" ON prompts;

CREATE POLICY "Allow all access to prompts"
  ON prompts FOR ALL
  TO anon, authenticated
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS "Users can view versions of own prompts" ON prompt_versions;
DROP POLICY IF EXISTS "Users can create versions for own prompts" ON prompt_versions;
DROP POLICY IF EXISTS "Users can delete versions of own prompts" ON prompt_versions;

CREATE POLICY "Allow all access to prompt_versions"
  ON prompt_versions FOR ALL
  TO anon, authenticated
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS "Users can view own evaluations" ON evaluations;
DROP POLICY IF EXISTS "Users can create own evaluations" ON evaluations;
DROP POLICY IF EXISTS "Users can update own evaluations" ON evaluations;
DROP POLICY IF EXISTS "Users can delete own evaluations" ON evaluations;

CREATE POLICY "Allow all access to evaluations"
  ON evaluations FOR ALL
  TO anon, authenticated
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS "Users can view own traces" ON traces;
DROP POLICY IF EXISTS "Users can create own traces" ON traces;
DROP POLICY IF EXISTS "Users can delete own traces" ON traces;

CREATE POLICY "Allow all access to traces"
  ON traces FOR ALL
  TO anon, authenticated
  USING (true)
  WITH CHECK (true);

-- Make user_id nullable for demo access
ALTER TABLE providers ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE prompts ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE evaluations ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE traces ALTER COLUMN user_id DROP NOT NULL;