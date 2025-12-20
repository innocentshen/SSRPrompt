/*
  # Initial Schema for AI Agent Platform (Coze Loop Replica)

  1. New Tables
    - `providers` - AI model provider configurations
      - `id` (uuid, primary key)
      - `user_id` (uuid, references auth.users)
      - `name` (text) - Display name for the provider
      - `type` (text) - Provider type (openai, anthropic, gemini, azure, custom)
      - `api_key` (text) - Encrypted API key(s), comma-separated for multiple
      - `base_url` (text) - API base URL
      - `enabled` (boolean) - Whether provider is active
      - `created_at` (timestamptz)
      - `updated_at` (timestamptz)

    - `models` - Model definitions linked to providers
      - `id` (uuid, primary key)
      - `provider_id` (uuid, references providers)
      - `model_id` (text) - Model identifier (e.g., gpt-4, claude-3)
      - `name` (text) - Display name
      - `capabilities` (text[]) - Array of capabilities (chat, vision, embedding)
      - `created_at` (timestamptz)

    - `prompts` - Prompt templates
      - `id` (uuid, primary key)
      - `user_id` (uuid, references auth.users)
      - `name` (text) - Prompt name
      - `description` (text) - Prompt description
      - `content` (text) - Current prompt content
      - `variables` (jsonb) - Variable definitions
      - `current_version` (integer) - Current version number
      - `created_at` (timestamptz)
      - `updated_at` (timestamptz)

    - `prompt_versions` - Prompt version history
      - `id` (uuid, primary key)
      - `prompt_id` (uuid, references prompts)
      - `version` (integer) - Version number
      - `content` (text) - Prompt content at this version
      - `commit_message` (text) - Change description
      - `created_at` (timestamptz)

    - `evaluations` - Evaluation sessions
      - `id` (uuid, primary key)
      - `user_id` (uuid, references auth.users)
      - `name` (text) - Evaluation name
      - `prompt_id` (uuid, references prompts)
      - `model_id` (uuid, references models)
      - `status` (text) - pending, running, completed, failed
      - `config` (jsonb) - Evaluation configuration
      - `results` (jsonb) - Evaluation results
      - `created_at` (timestamptz)
      - `completed_at` (timestamptz)

    - `traces` - AI call traces for observability
      - `id` (uuid, primary key)
      - `user_id` (uuid, references auth.users)
      - `prompt_id` (uuid, references prompts, nullable)
      - `model_id` (uuid, references models, nullable)
      - `input` (text) - Request input
      - `output` (text) - Response output
      - `tokens_input` (integer) - Input tokens used
      - `tokens_output` (integer) - Output tokens used
      - `latency_ms` (integer) - Response time in milliseconds
      - `status` (text) - success, error
      - `error_message` (text, nullable)
      - `metadata` (jsonb) - Additional trace data
      - `created_at` (timestamptz)

  2. Security
    - Enable RLS on all tables
    - Add policies for authenticated users to manage their own data
*/

-- Providers table
CREATE TABLE IF NOT EXISTS providers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  name text NOT NULL,
  type text NOT NULL CHECK (type IN ('openai', 'anthropic', 'gemini', 'azure', 'custom')),
  api_key text NOT NULL,
  base_url text,
  enabled boolean DEFAULT false,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE providers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own providers"
  ON providers FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can create own providers"
  ON providers FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own providers"
  ON providers FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own providers"
  ON providers FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

-- Models table
CREATE TABLE IF NOT EXISTS models (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id uuid REFERENCES providers(id) ON DELETE CASCADE NOT NULL,
  model_id text NOT NULL,
  name text NOT NULL,
  capabilities text[] DEFAULT '{}',
  created_at timestamptz DEFAULT now()
);

ALTER TABLE models ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view models of own providers"
  ON models FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM providers
      WHERE providers.id = models.provider_id
      AND providers.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can create models for own providers"
  ON models FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM providers
      WHERE providers.id = models.provider_id
      AND providers.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can update models of own providers"
  ON models FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM providers
      WHERE providers.id = models.provider_id
      AND providers.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM providers
      WHERE providers.id = models.provider_id
      AND providers.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can delete models of own providers"
  ON models FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM providers
      WHERE providers.id = models.provider_id
      AND providers.user_id = auth.uid()
    )
  );

-- Prompts table
CREATE TABLE IF NOT EXISTS prompts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  name text NOT NULL,
  description text DEFAULT '',
  content text DEFAULT '',
  variables jsonb DEFAULT '[]',
  current_version integer DEFAULT 1,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE prompts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own prompts"
  ON prompts FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can create own prompts"
  ON prompts FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own prompts"
  ON prompts FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own prompts"
  ON prompts FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

-- Prompt versions table
CREATE TABLE IF NOT EXISTS prompt_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  prompt_id uuid REFERENCES prompts(id) ON DELETE CASCADE NOT NULL,
  version integer NOT NULL,
  content text NOT NULL,
  commit_message text DEFAULT '',
  created_at timestamptz DEFAULT now()
);

ALTER TABLE prompt_versions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view versions of own prompts"
  ON prompt_versions FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM prompts
      WHERE prompts.id = prompt_versions.prompt_id
      AND prompts.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can create versions for own prompts"
  ON prompt_versions FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM prompts
      WHERE prompts.id = prompt_versions.prompt_id
      AND prompts.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can delete versions of own prompts"
  ON prompt_versions FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM prompts
      WHERE prompts.id = prompt_versions.prompt_id
      AND prompts.user_id = auth.uid()
    )
  );

-- Evaluations table
CREATE TABLE IF NOT EXISTS evaluations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  name text NOT NULL,
  prompt_id uuid REFERENCES prompts(id) ON DELETE SET NULL,
  model_id uuid REFERENCES models(id) ON DELETE SET NULL,
  status text DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'completed', 'failed')),
  config jsonb DEFAULT '{}',
  results jsonb DEFAULT '{}',
  created_at timestamptz DEFAULT now(),
  completed_at timestamptz
);

ALTER TABLE evaluations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own evaluations"
  ON evaluations FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can create own evaluations"
  ON evaluations FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own evaluations"
  ON evaluations FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own evaluations"
  ON evaluations FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

-- Traces table
CREATE TABLE IF NOT EXISTS traces (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  prompt_id uuid REFERENCES prompts(id) ON DELETE SET NULL,
  model_id uuid REFERENCES models(id) ON DELETE SET NULL,
  input text NOT NULL,
  output text DEFAULT '',
  tokens_input integer DEFAULT 0,
  tokens_output integer DEFAULT 0,
  latency_ms integer DEFAULT 0,
  status text DEFAULT 'success' CHECK (status IN ('success', 'error')),
  error_message text,
  metadata jsonb DEFAULT '{}',
  created_at timestamptz DEFAULT now()
);

ALTER TABLE traces ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own traces"
  ON traces FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can create own traces"
  ON traces FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own traces"
  ON traces FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

-- Create indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_providers_user_id ON providers(user_id);
CREATE INDEX IF NOT EXISTS idx_models_provider_id ON models(provider_id);
CREATE INDEX IF NOT EXISTS idx_prompts_user_id ON prompts(user_id);
CREATE INDEX IF NOT EXISTS idx_prompt_versions_prompt_id ON prompt_versions(prompt_id);
CREATE INDEX IF NOT EXISTS idx_evaluations_user_id ON evaluations(user_id);
CREATE INDEX IF NOT EXISTS idx_traces_user_id ON traces(user_id);
CREATE INDEX IF NOT EXISTS idx_traces_created_at ON traces(created_at DESC);