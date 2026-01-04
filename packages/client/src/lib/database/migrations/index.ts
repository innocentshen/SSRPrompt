/**
 * 数据库迁移管理器
 *
 * 用于管理和执行数据库 schema 迁移
 */

import type { Migration, MigrationStatus, MigrationResult, DatabaseService } from '../types';

// 导入所有迁移
import { migration as migration001 } from './001_initial';
import { migration as migration003 } from './003_add_model_vision_support';
import { migration as migration004 } from './004_add_reasoning_support';
import { migration as migration005 } from './005_add_evaluation_model_params';
import { migration as migration006 } from './006_add_attachments_column';

// 注册所有迁移（按版本号排序）
export const allMigrations: Migration[] = [
  migration001,
  migration003,
  migration004,
  migration005,
  migration006,
].sort((a, b) => a.version - b.version);

/**
 * 获取迁移状态
 */
export async function getMigrationStatus(db: DatabaseService): Promise<MigrationStatus> {
  const currentVersion = await db.getSchemaVersion();
  const latestVersion = allMigrations.length > 0
    ? allMigrations[allMigrations.length - 1].version
    : 0;

  const pendingMigrations = allMigrations.filter(m => m.version > currentVersion);

  return {
    currentVersion,
    latestVersion,
    pendingMigrations,
    isUpToDate: currentVersion >= latestVersion
  };
}

/**
 * 执行所有待处理的迁移
 */
export async function runPendingMigrations(db: DatabaseService): Promise<MigrationResult> {
  const status = await getMigrationStatus(db);

  if (status.isUpToDate) {
    return {
      success: true,
      executedMigrations: [],
      currentVersion: status.currentVersion
    };
  }

  return db.runMigrations(status.pendingMigrations);
}

/**
 * 获取最新版本号
 */
export function getLatestVersion(): number {
  return allMigrations.length > 0
    ? allMigrations[allMigrations.length - 1].version
    : 0;
}

/**
 * 格式化迁移列表用于显示
 */
export function formatMigrationList(migrations: Migration[]): string[] {
  return migrations.map(m => `v${m.version}: ${m.description}`);
}

/**
 * 生成待执行迁移的 SQL 脚本（用于 Supabase 手动执行）
 * @param pendingMigrations 待执行的迁移列表
 * @param dbType 数据库类型
 */
export function generatePendingMigrationSQL(
  pendingMigrations: Migration[],
  dbType: 'mysql' | 'postgresql' = 'postgresql'
): string {
  if (pendingMigrations.length === 0) {
    return '-- 没有待执行的迁移';
  }

  const header = `-- 数据库升级脚本
-- 生成时间: ${new Date().toLocaleString()}
-- 待执行迁移: ${pendingMigrations.length} 个
-- 请在 Supabase Dashboard > SQL Editor 中执行此脚本

`;

  const migrationScripts = pendingMigrations.map(m => {
    const sql = dbType === 'mysql' ? m.mysql : m.postgresql;
    return `-- =====================================================
-- 迁移 v${m.version}: ${m.description}
-- =====================================================

${sql}

-- 记录迁移版本
INSERT INTO schema_migrations (version, name) VALUES (${m.version}, '${m.name}') ON CONFLICT (version) DO NOTHING;
`;
  });

  return header + migrationScripts.join('\n');
}
