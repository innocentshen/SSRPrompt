/*
  # Add Evaluation Runs (Execution History)

  1. New Tables
    - `evaluation_runs` - Records each evaluation execution
      - `id` (uuid, primary key)
      - `evaluation_id` (uuid, references evaluations)
      - `status` (text) - pending, running, completed, failed
      - `results` (jsonb) - Summary results for this run
      - `error_message` (text, nullable) - Error message if failed
      - `started_at` (timestamptz)
      - `completed_at` (timestamptz, nullable)
      - `created_at` (timestamptz)

  2. Changes to Existing Tables
    - Add `run_id` column to `test_case_results` to associate results with runs

  3. Security
    - Enable RLS on `evaluation_runs`
    - Add policies for authenticated users to manage their own runs

  4. Notes
    - This allows tracking multiple executions of the same evaluation
    - Each run maintains its own set of test case results
    - Historical results are preserved for comparison
*/

-- Evaluation runs table
CREATE TABLE IF NOT EXISTS evaluation_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  evaluation_id uuid REFERENCES evaluations(id) ON DELETE CASCADE NOT NULL,
  status text DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'completed', 'failed')),
  results jsonb DEFAULT '{}',
  error_message text,
  started_at timestamptz DEFAULT now(),
  completed_at timestamptz,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE evaluation_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view runs of own evaluations"
  ON evaluation_runs FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM evaluations
      WHERE evaluations.id = evaluation_runs.evaluation_id
      AND evaluations.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can create runs for own evaluations"
  ON evaluation_runs FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM evaluations
      WHERE evaluations.id = evaluation_runs.evaluation_id
      AND evaluations.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can update runs of own evaluations"
  ON evaluation_runs FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM evaluations
      WHERE evaluations.id = evaluation_runs.evaluation_id
      AND evaluations.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM evaluations
      WHERE evaluations.id = evaluation_runs.evaluation_id
      AND evaluations.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can delete runs of own evaluations"
  ON evaluation_runs FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM evaluations
      WHERE evaluations.id = evaluation_runs.evaluation_id
      AND evaluations.user_id = auth.uid()
    )
  );

-- Add run_id to test_case_results
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'test_case_results' AND column_name = 'run_id'
  ) THEN
    ALTER TABLE test_case_results ADD COLUMN run_id uuid REFERENCES evaluation_runs(id) ON DELETE CASCADE;
  END IF;
END $$;

-- Create indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_evaluation_runs_evaluation_id ON evaluation_runs(evaluation_id);
CREATE INDEX IF NOT EXISTS idx_evaluation_runs_status ON evaluation_runs(status);
CREATE INDEX IF NOT EXISTS idx_evaluation_runs_created_at ON evaluation_runs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_test_case_results_run_id ON test_case_results(run_id);