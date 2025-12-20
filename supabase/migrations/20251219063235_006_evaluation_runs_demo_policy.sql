/*
  # Add Demo Access Policy for Evaluation Runs

  1. Changes
    - Drop restrictive RLS policies on evaluation_runs
    - Add permissive policy for demo access (anon and authenticated)

  2. Security Note
    - These policies are for demonstration only
    - Production deployments should use proper authentication
*/

DROP POLICY IF EXISTS "Users can view runs of own evaluations" ON evaluation_runs;
DROP POLICY IF EXISTS "Users can create runs for own evaluations" ON evaluation_runs;
DROP POLICY IF EXISTS "Users can update runs of own evaluations" ON evaluation_runs;
DROP POLICY IF EXISTS "Users can delete runs of own evaluations" ON evaluation_runs;

CREATE POLICY "Allow all access to evaluation_runs"
  ON evaluation_runs FOR ALL
  TO anon, authenticated
  USING (true)
  WITH CHECK (true);