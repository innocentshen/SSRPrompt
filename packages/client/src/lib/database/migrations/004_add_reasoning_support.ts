import type { Migration } from '../types';

// 添加推理和函数调用支持字段
export const migration: Migration = {
  version: 4,
  name: 'add_reasoning_support',
  description: '添加模型推理能力和思考内容存储字段',

  mysql: `
-- 为 models 表添加 supports_reasoning 字段
SET @column_exists = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME = 'models'
  AND COLUMN_NAME = 'supports_reasoning'
);
SET @sql = IF(@column_exists = 0,
  'ALTER TABLE models ADD COLUMN supports_reasoning BOOLEAN DEFAULT FALSE',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 为 models 表添加 supports_function_calling 字段
SET @column_exists = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME = 'models'
  AND COLUMN_NAME = 'supports_function_calling'
);
SET @sql = IF(@column_exists = 0,
  'ALTER TABLE models ADD COLUMN supports_function_calling BOOLEAN DEFAULT FALSE',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 为 traces 表添加 thinking_content 字段
SET @column_exists = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME = 'traces'
  AND COLUMN_NAME = 'thinking_content'
);
SET @sql = IF(@column_exists = 0,
  'ALTER TABLE traces ADD COLUMN thinking_content TEXT',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 为 traces 表添加 thinking_time_ms 字段
SET @column_exists = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME = 'traces'
  AND COLUMN_NAME = 'thinking_time_ms'
);
SET @sql = IF(@column_exists = 0,
  'ALTER TABLE traces ADD COLUMN thinking_time_ms INT UNSIGNED',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
`,

  postgresql: `
-- 为 models 表添加推理相关字段
ALTER TABLE models ADD COLUMN IF NOT EXISTS supports_reasoning boolean DEFAULT false;
ALTER TABLE models ADD COLUMN IF NOT EXISTS supports_function_calling boolean DEFAULT false;

-- 为 traces 表添加思考内容字段
ALTER TABLE traces ADD COLUMN IF NOT EXISTS thinking_content text;
ALTER TABLE traces ADD COLUMN IF NOT EXISTS thinking_time_ms integer;
`
};
