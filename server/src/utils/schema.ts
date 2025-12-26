export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS providers (
  id VARCHAR(36) PRIMARY KEY DEFAULT (UUID()),
  user_id VARCHAR(36) NOT NULL DEFAULT 'demo',
  name VARCHAR(255) NOT NULL,
  type ENUM('openai', 'anthropic', 'gemini', 'azure', 'custom') NOT NULL,
  api_key TEXT NOT NULL,
  base_url TEXT,
  enabled BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_providers_user_id (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS models (
  id VARCHAR(36) PRIMARY KEY DEFAULT (UUID()),
  provider_id VARCHAR(36) NOT NULL,
  model_id VARCHAR(255) NOT NULL,
  name VARCHAR(255) NOT NULL,
  capabilities JSON,
  supports_vision BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_models_provider_id (provider_id),
  FOREIGN KEY (provider_id) REFERENCES providers(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

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
`;
