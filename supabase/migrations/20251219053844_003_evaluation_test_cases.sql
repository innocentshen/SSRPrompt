/*
  # Evaluation Test Cases and AI Criteria

  1. New Tables
    - `test_cases`
      - `id` (uuid, primary key)
      - `evaluation_id` (uuid, references evaluations)
      - `name` (text) - test case name
      - `input_text` (text) - text input for the test
      - `input_variables` (jsonb) - variables to inject into prompt
      - `attachments` (jsonb) - array of file attachments (name, type, base64)
      - `expected_output` (text, nullable) - expected output for comparison
      - `order_index` (integer) - order in the test suite
      - `created_at` (timestamptz)
      
    - `evaluation_criteria`
      - `id` (uuid, primary key)
      - `evaluation_id` (uuid, references evaluations)
      - `name` (text) - criterion name (e.g., "accuracy", "relevance")
      - `description` (text) - description of the criterion
      - `prompt` (text) - AI evaluation prompt template
      - `weight` (numeric) - weight for scoring (0-1)
      - `enabled` (boolean)
      - `created_at` (timestamptz)
      
    - `test_case_results`
      - `id` (uuid, primary key)
      - `evaluation_id` (uuid, references evaluations)
      - `test_case_id` (uuid, references test_cases)
      - `model_output` (text) - actual output from the model
      - `scores` (jsonb) - scores per criterion
      - `ai_feedback` (jsonb) - AI evaluation feedback per criterion
      - `latency_ms` (integer)
      - `tokens_input` (integer)
      - `tokens_output` (integer)
      - `passed` (boolean)
      - `error_message` (text, nullable)
      - `created_at` (timestamptz)

  2. Security
    - Enable RLS on all new tables
    - Add policies for demo access (matching existing pattern)
*/

-- Test Cases Table
CREATE TABLE IF NOT EXISTS test_cases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  evaluation_id uuid NOT NULL REFERENCES evaluations(id) ON DELETE CASCADE,
  name text NOT NULL DEFAULT '',
  input_text text NOT NULL DEFAULT '',
  input_variables jsonb NOT NULL DEFAULT '{}',
  attachments jsonb NOT NULL DEFAULT '[]',
  expected_output text,
  order_index integer NOT NULL DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE test_cases ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all access to test_cases for demo"
  ON test_cases FOR ALL
  USING (true)
  WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_test_cases_evaluation_id ON test_cases(evaluation_id);
CREATE INDEX IF NOT EXISTS idx_test_cases_order ON test_cases(evaluation_id, order_index);

-- Evaluation Criteria Table
CREATE TABLE IF NOT EXISTS evaluation_criteria (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  evaluation_id uuid NOT NULL REFERENCES evaluations(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  prompt text NOT NULL DEFAULT '',
  weight numeric(3,2) NOT NULL DEFAULT 1.0 CHECK (weight >= 0 AND weight <= 1),
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE evaluation_criteria ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all access to evaluation_criteria for demo"
  ON evaluation_criteria FOR ALL
  USING (true)
  WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_evaluation_criteria_evaluation_id ON evaluation_criteria(evaluation_id);

-- Test Case Results Table
CREATE TABLE IF NOT EXISTS test_case_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  evaluation_id uuid NOT NULL REFERENCES evaluations(id) ON DELETE CASCADE,
  test_case_id uuid NOT NULL REFERENCES test_cases(id) ON DELETE CASCADE,
  model_output text NOT NULL DEFAULT '',
  scores jsonb NOT NULL DEFAULT '{}',
  ai_feedback jsonb NOT NULL DEFAULT '{}',
  latency_ms integer NOT NULL DEFAULT 0,
  tokens_input integer NOT NULL DEFAULT 0,
  tokens_output integer NOT NULL DEFAULT 0,
  passed boolean NOT NULL DEFAULT false,
  error_message text,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE test_case_results ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all access to test_case_results for demo"
  ON test_case_results FOR ALL
  USING (true)
  WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_test_case_results_evaluation_id ON test_case_results(evaluation_id);
CREATE INDEX IF NOT EXISTS idx_test_case_results_test_case_id ON test_case_results(test_case_id);

-- Add judge_model_id to evaluations for AI evaluation
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'evaluations' AND column_name = 'judge_model_id'
  ) THEN
    ALTER TABLE evaluations ADD COLUMN judge_model_id uuid REFERENCES models(id);
  END IF;
END $$;
