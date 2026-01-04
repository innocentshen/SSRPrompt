import type { Migration } from '../types';

// 初始化迁移 - 创建所有基础表
// 注意：此迁移需要同时创建 schema_migrations 表

export const migration: Migration = {
  version: 1,
  name: 'initial',
  description: '创建所有基础表结构',

  mysql: `
-- schema_migrations 表用于记录迁移版本
CREATE TABLE IF NOT EXISTS schema_migrations (
  version INT PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  executed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- AI 服务商表
CREATE TABLE IF NOT EXISTS providers (
  id VARCHAR(36) PRIMARY KEY DEFAULT (UUID()),
  user_id VARCHAR(36) NOT NULL DEFAULT 'demo',
  name VARCHAR(255) NOT NULL,
  type ENUM('openai', 'anthropic', 'gemini', 'custom', 'openrouter') NOT NULL,
  api_key TEXT NOT NULL,
  base_url TEXT,
  enabled BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_providers_user_id (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 模型表
CREATE TABLE IF NOT EXISTS models (
  id VARCHAR(36) PRIMARY KEY DEFAULT (UUID()),
  provider_id VARCHAR(36) NOT NULL,
  model_id VARCHAR(255) NOT NULL,
  name VARCHAR(255) NOT NULL,
  capabilities JSON,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_models_provider_id (provider_id),
  FOREIGN KEY (provider_id) REFERENCES providers(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Prompt 表
CREATE TABLE IF NOT EXISTS prompts (
  id VARCHAR(36) PRIMARY KEY DEFAULT (UUID()),
  user_id VARCHAR(36) NOT NULL DEFAULT 'demo',
  name VARCHAR(255) NOT NULL,
  description TEXT,
  content TEXT,
  variables JSON,
  messages JSON,
  config JSON,
  current_version INT DEFAULT 1,
  default_model_id VARCHAR(36),
  order_index INT DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_prompts_user_id (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Prompt 版本历史表
CREATE TABLE IF NOT EXISTS prompt_versions (
  id VARCHAR(36) PRIMARY KEY DEFAULT (UUID()),
  prompt_id VARCHAR(36) NOT NULL,
  version INT NOT NULL,
  content TEXT NOT NULL,
  commit_message TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_prompt_versions_prompt_id (prompt_id),
  FOREIGN KEY (prompt_id) REFERENCES prompts(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 评测表
CREATE TABLE IF NOT EXISTS evaluations (
  id VARCHAR(36) PRIMARY KEY DEFAULT (UUID()),
  user_id VARCHAR(36) NOT NULL DEFAULT 'demo',
  name VARCHAR(255) NOT NULL,
  prompt_id VARCHAR(36),
  model_id VARCHAR(36),
  judge_model_id VARCHAR(36),
  status ENUM('pending', 'running', 'completed', 'failed') DEFAULT 'pending',
  config JSON,
  results JSON,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  completed_at TIMESTAMP,
  INDEX idx_evaluations_user_id (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 评测运行记录表
CREATE TABLE IF NOT EXISTS evaluation_runs (
  id VARCHAR(36) PRIMARY KEY DEFAULT (UUID()),
  evaluation_id VARCHAR(36) NOT NULL,
  status ENUM('pending', 'running', 'completed', 'failed') DEFAULT 'pending',
  results JSON,
  error_message TEXT,
  total_tokens_input INT DEFAULT 0,
  total_tokens_output INT DEFAULT 0,
  started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  completed_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_evaluation_runs_evaluation_id (evaluation_id),
  INDEX idx_evaluation_runs_status (status),
  INDEX idx_evaluation_runs_created_at (created_at DESC),
  FOREIGN KEY (evaluation_id) REFERENCES evaluations(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 测试用例表
CREATE TABLE IF NOT EXISTS test_cases (
  id VARCHAR(36) PRIMARY KEY DEFAULT (UUID()),
  evaluation_id VARCHAR(36) NOT NULL,
  name VARCHAR(255) DEFAULT '',
  input_text TEXT NOT NULL,
  input_variables JSON,
  attachments JSON,
  expected_output TEXT,
  notes TEXT,
  order_index INT DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_test_cases_evaluation_id (evaluation_id),
  INDEX idx_test_cases_order (evaluation_id, order_index),
  FOREIGN KEY (evaluation_id) REFERENCES evaluations(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 评价标准表
CREATE TABLE IF NOT EXISTS evaluation_criteria (
  id VARCHAR(36) PRIMARY KEY DEFAULT (UUID()),
  evaluation_id VARCHAR(36) NOT NULL,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  prompt TEXT,
  weight DECIMAL(5,2) DEFAULT 1.0,
  enabled BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_evaluation_criteria_evaluation_id (evaluation_id),
  FOREIGN KEY (evaluation_id) REFERENCES evaluations(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 测试用例结果表
CREATE TABLE IF NOT EXISTS test_case_results (
  id VARCHAR(36) PRIMARY KEY DEFAULT (UUID()),
  evaluation_id VARCHAR(36) NOT NULL,
  test_case_id VARCHAR(36) NOT NULL,
  run_id VARCHAR(36),
  model_output TEXT,
  scores JSON,
  ai_feedback JSON,
  latency_ms INT DEFAULT 0,
  tokens_input INT DEFAULT 0,
  tokens_output INT DEFAULT 0,
  passed BOOLEAN DEFAULT FALSE,
  error_message TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_test_case_results_evaluation_id (evaluation_id),
  INDEX idx_test_case_results_test_case_id (test_case_id),
  INDEX idx_test_case_results_run_id (run_id),
  FOREIGN KEY (evaluation_id) REFERENCES evaluations(id) ON DELETE CASCADE,
  FOREIGN KEY (test_case_id) REFERENCES test_cases(id) ON DELETE CASCADE,
  FOREIGN KEY (run_id) REFERENCES evaluation_runs(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 调用追踪表
CREATE TABLE IF NOT EXISTS traces (
  id VARCHAR(36) PRIMARY KEY DEFAULT (UUID()),
  user_id VARCHAR(36) NOT NULL DEFAULT 'demo',
  prompt_id VARCHAR(36),
  model_id VARCHAR(36),
  input TEXT NOT NULL,
  output TEXT,
  tokens_input INT DEFAULT 0,
  tokens_output INT DEFAULT 0,
  latency_ms INT DEFAULT 0,
  status ENUM('success', 'error') DEFAULT 'success',
  error_message TEXT,
  metadata JSON,
  attachments JSON,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_traces_user_id (user_id),
  INDEX idx_traces_created_at (created_at DESC)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
`,

  postgresql: `
-- schema_migrations 表用于记录迁移版本
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
  type text NOT NULL CHECK (type IN ('openai', 'anthropic', 'gemini', 'custom', 'openrouter')),
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

-- 启用行级安全策略 (RLS)
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
ALTER TABLE schema_migrations ENABLE ROW LEVEL SECURITY;

-- 创建访问策略
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
CREATE POLICY "Allow all access to schema_migrations" ON schema_migrations FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

-- 创建索引
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
`
};
