// Supabase 数据库初始化 SQL
// 合并了所有迁移文件，为用户提供一键初始化

export const SUPABASE_INIT_SQL = `-- SSRPrompt Supabase 数据库初始化脚本
-- 请在 Supabase Dashboard > SQL Editor 中执行此脚本

-- =====================================================
-- 1. 创建基础表结构
-- =====================================================

-- 迁移版本记录表
CREATE TABLE IF NOT EXISTS schema_migrations (
  version INT PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  executed_at TIMESTAMPTZ DEFAULT NOW()
);

-- AI 服务商表
CREATE TABLE IF NOT EXISTS providers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid,
  name text NOT NULL,
  type text NOT NULL CHECK (type IN ('openai', 'anthropic', 'gemini', 'azure', 'custom')),
  api_key text NOT NULL,
  base_url text,
  enabled boolean DEFAULT false,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- 模型表
CREATE TABLE IF NOT EXISTS models (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id uuid REFERENCES providers(id) ON DELETE CASCADE NOT NULL,
  model_id text NOT NULL,
  name text NOT NULL,
  capabilities text[] DEFAULT '{}',
  supports_vision boolean DEFAULT true,
  created_at timestamptz DEFAULT now()
);

-- Prompt 表
CREATE TABLE IF NOT EXISTS prompts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid,
  name text NOT NULL,
  description text DEFAULT '',
  content text DEFAULT '',
  variables jsonb DEFAULT '[]',
  messages jsonb DEFAULT '[]',
  config jsonb DEFAULT '{}',
  current_version integer DEFAULT 1,
  default_model_id uuid REFERENCES models(id) ON DELETE SET NULL,
  order_index integer DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Prompt 版本历史表
CREATE TABLE IF NOT EXISTS prompt_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  prompt_id uuid REFERENCES prompts(id) ON DELETE CASCADE NOT NULL,
  version integer NOT NULL,
  content text NOT NULL,
  commit_message text DEFAULT '',
  created_at timestamptz DEFAULT now()
);

-- 评测表
CREATE TABLE IF NOT EXISTS evaluations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid,
  name text NOT NULL,
  prompt_id uuid REFERENCES prompts(id) ON DELETE SET NULL,
  model_id uuid REFERENCES models(id) ON DELETE SET NULL,
  judge_model_id uuid REFERENCES models(id),
  status text DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'completed', 'failed')),
  config jsonb DEFAULT '{}',
  results jsonb DEFAULT '{}',
  created_at timestamptz DEFAULT now(),
  completed_at timestamptz
);

-- 测试用例表
CREATE TABLE IF NOT EXISTS test_cases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  evaluation_id uuid NOT NULL REFERENCES evaluations(id) ON DELETE CASCADE,
  name text NOT NULL DEFAULT '',
  input_text text NOT NULL DEFAULT '',
  input_variables jsonb NOT NULL DEFAULT '{}',
  attachments jsonb NOT NULL DEFAULT '[]',
  expected_output text,
  notes text,
  order_index integer NOT NULL DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

-- 评价标准表
CREATE TABLE IF NOT EXISTS evaluation_criteria (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  evaluation_id uuid NOT NULL REFERENCES evaluations(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  prompt text NOT NULL DEFAULT '',
  weight numeric(5,2) NOT NULL DEFAULT 1.0 CHECK (weight >= 0),
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz DEFAULT now()
);

-- 评测运行记录表
CREATE TABLE IF NOT EXISTS evaluation_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  evaluation_id uuid REFERENCES evaluations(id) ON DELETE CASCADE NOT NULL,
  status text DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'completed', 'failed')),
  results jsonb DEFAULT '{}',
  error_message text,
  total_tokens_input integer DEFAULT 0,
  total_tokens_output integer DEFAULT 0,
  started_at timestamptz DEFAULT now(),
  completed_at timestamptz,
  created_at timestamptz DEFAULT now()
);

-- 测试用例结果表
CREATE TABLE IF NOT EXISTS test_case_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  evaluation_id uuid NOT NULL REFERENCES evaluations(id) ON DELETE CASCADE,
  test_case_id uuid NOT NULL REFERENCES test_cases(id) ON DELETE CASCADE,
  run_id uuid REFERENCES evaluation_runs(id) ON DELETE CASCADE,
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

-- 调用追踪表
CREATE TABLE IF NOT EXISTS traces (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid,
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
  attachments jsonb NOT NULL DEFAULT '[]',
  created_at timestamptz DEFAULT now()
);

-- =====================================================
-- 2. 启用行级安全策略 (RLS)
-- =====================================================

ALTER TABLE schema_migrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE providers ENABLE ROW LEVEL SECURITY;
ALTER TABLE models ENABLE ROW LEVEL SECURITY;
ALTER TABLE prompts ENABLE ROW LEVEL SECURITY;
ALTER TABLE prompt_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE evaluations ENABLE ROW LEVEL SECURITY;
ALTER TABLE test_cases ENABLE ROW LEVEL SECURITY;
ALTER TABLE evaluation_criteria ENABLE ROW LEVEL SECURITY;
ALTER TABLE evaluation_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE test_case_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE traces ENABLE ROW LEVEL SECURITY;

-- =====================================================
-- 3. 创建访问策略 (允许匿名访问，用于演示)
-- =====================================================

CREATE POLICY "Allow all access to schema_migrations" ON schema_migrations FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Allow all access to providers" ON providers FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Allow all access to models" ON models FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Allow all access to prompts" ON prompts FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Allow all access to prompt_versions" ON prompt_versions FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Allow all access to evaluations" ON evaluations FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Allow all access to test_cases" ON test_cases FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Allow all access to evaluation_criteria" ON evaluation_criteria FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Allow all access to evaluation_runs" ON evaluation_runs FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Allow all access to test_case_results" ON test_case_results FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Allow all access to traces" ON traces FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

-- =====================================================
-- 4. 创建索引优化查询性能
-- =====================================================

CREATE INDEX IF NOT EXISTS idx_providers_user_id ON providers(user_id);
CREATE INDEX IF NOT EXISTS idx_models_provider_id ON models(provider_id);
CREATE INDEX IF NOT EXISTS idx_prompts_user_id ON prompts(user_id);
CREATE INDEX IF NOT EXISTS idx_prompt_versions_prompt_id ON prompt_versions(prompt_id);
CREATE INDEX IF NOT EXISTS idx_evaluations_user_id ON evaluations(user_id);
CREATE INDEX IF NOT EXISTS idx_test_cases_evaluation_id ON test_cases(evaluation_id);
CREATE INDEX IF NOT EXISTS idx_test_cases_order ON test_cases(evaluation_id, order_index);
CREATE INDEX IF NOT EXISTS idx_evaluation_criteria_evaluation_id ON evaluation_criteria(evaluation_id);
CREATE INDEX IF NOT EXISTS idx_evaluation_runs_evaluation_id ON evaluation_runs(evaluation_id);
CREATE INDEX IF NOT EXISTS idx_evaluation_runs_status ON evaluation_runs(status);
CREATE INDEX IF NOT EXISTS idx_evaluation_runs_created_at ON evaluation_runs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_test_case_results_evaluation_id ON test_case_results(evaluation_id);
CREATE INDEX IF NOT EXISTS idx_test_case_results_test_case_id ON test_case_results(test_case_id);
CREATE INDEX IF NOT EXISTS idx_test_case_results_run_id ON test_case_results(run_id);
CREATE INDEX IF NOT EXISTS idx_traces_user_id ON traces(user_id);
CREATE INDEX IF NOT EXISTS idx_traces_created_at ON traces(created_at DESC);

-- =====================================================
-- 5. 记录初始迁移版本
-- =====================================================

INSERT INTO schema_migrations (version, name) VALUES (1, 'initial') ON CONFLICT (version) DO NOTHING;

-- =====================================================
-- 初始化完成！
-- =====================================================
`;
