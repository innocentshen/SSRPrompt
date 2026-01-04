/**
 * 迁移 006: 为 evaluation_test_cases 和 traces 表添加 attachments 列
 *
 * 此迁移用于修复早期创建的数据库中缺少 attachments 字段的问题
 */

export const migration = {
  version: 6,
  name: 'add_attachments_column',
  description: '为 evaluation_test_cases 和 traces 表添加 attachments 列',
  mysql: `
    -- 为 evaluation_test_cases 表添加 attachments 列（如果不存在）
    SET @column_exists = (
      SELECT COUNT(*) FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'evaluation_test_cases'
      AND COLUMN_NAME = 'attachments'
    );
    SET @sql = IF(@column_exists = 0,
      'ALTER TABLE evaluation_test_cases ADD COLUMN attachments JSON',
      'SELECT 1'
    );
    PREPARE stmt FROM @sql;
    EXECUTE stmt;
    DEALLOCATE PREPARE stmt;

    -- 为 traces 表添加 attachments 列（如果不存在）
    SET @column_exists2 = (
      SELECT COUNT(*) FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'traces'
      AND COLUMN_NAME = 'attachments'
    );
    SET @sql2 = IF(@column_exists2 = 0,
      'ALTER TABLE traces ADD COLUMN attachments JSON',
      'SELECT 1'
    );
    PREPARE stmt2 FROM @sql2;
    EXECUTE stmt2;
    DEALLOCATE PREPARE stmt2;
  `,
  postgresql: `
    -- 为 evaluation_test_cases 表添加 attachments 列（如果不存在）
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'evaluation_test_cases' AND column_name = 'attachments'
      ) THEN
        ALTER TABLE evaluation_test_cases ADD COLUMN attachments jsonb NOT NULL DEFAULT '[]';
      END IF;
    END $$;

    -- 为 traces 表添加 attachments 列（如果不存在）
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'traces' AND column_name = 'attachments'
      ) THEN
        ALTER TABLE traces ADD COLUMN attachments jsonb NOT NULL DEFAULT '[]';
      END IF;
    END $$;
  `
};
