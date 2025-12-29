import type { Migration } from '../types';

// 为评测添加模型参数配置
export const migration: Migration = {
  version: 5,
  name: 'add_evaluation_model_params',
  description: '为评测运行添加模型参数记录',

  mysql: `
-- 为 evaluation_runs 表添加 model_parameters 字段
SET @column_exists = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME = 'evaluation_runs'
  AND COLUMN_NAME = 'model_parameters'
);
SET @sql = IF(@column_exists = 0,
  'ALTER TABLE evaluation_runs ADD COLUMN model_parameters JSON',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
`,

  postgresql: `
-- 为 evaluation_runs 表添加 model_parameters 字段
ALTER TABLE evaluation_runs ADD COLUMN IF NOT EXISTS model_parameters jsonb;
`
};
