import type { Migration } from '../types';

// 添加模型视觉支持字段
export const migration: Migration = {
  version: 3,
  name: 'add_model_vision_support',
  description: '添加模型视觉支持字段',

  mysql: `
-- 为 models 表添加 supports_vision 字段
-- 使用存储过程来实现 IF NOT EXISTS 逻辑
SET @column_exists = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME = 'models'
  AND COLUMN_NAME = 'supports_vision'
);

SET @sql = IF(@column_exists = 0,
  'ALTER TABLE models ADD COLUMN supports_vision BOOLEAN DEFAULT TRUE',
  'SELECT 1'
);

PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
`,

  postgresql: `
-- 为 models 表添加 supports_vision 字段
ALTER TABLE models ADD COLUMN IF NOT EXISTS supports_vision boolean DEFAULT true;
`
};
