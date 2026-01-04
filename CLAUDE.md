# Claude Code 项目指令

## 项目简介

这是一个 Prompt 管理和评测平台，支持 Supabase 和 MySQL 两种数据库。

## 数据库表结构更新规范

**重要**: 当编写涉及数据库表结构变更的代码时，必须同时维护迁移系统：

1. **新增/修改字段时**，需要在以下位置同步更新：
   - `src/lib/database/migrations/` - 创建新的迁移文件
   - `server/src/utils/schema.ts` - MySQL 完整 schema
   - `src/lib/database/supabase-init-sql.ts` - Supabase 完整 schema
   - `supabase/functions/mysql-proxy/index.ts` - Edge Function MySQL schema
   - `src/types/database.ts` - TypeScript 类型定义

2. **迁移文件命名规范**: `XXX_描述.ts`，如 `002_add_traces_attachments.ts`

3. **迁移文件格式**:
```typescript
export const migration = {
  version: 2,                    // 递增版本号
  name: 'add_traces_attachments', // 迁移名称
  description: '描述变更内容',
  mysql: `ALTER TABLE ...`,      // MySQL 迁移 SQL
  postgresql: `ALTER TABLE ...`  // PostgreSQL 迁移 SQL
};
```

4. **版本号确定规则（重要）**:
   - 新建迁移文件前，必须先检查 `migrations/index.ts` 中已注册的最高版本号
   - 新迁移版本号 = 已有最高版本号 + 1
   - **注意**：用户数据库的 `schema_migrations` 表可能已记录了某些版本号（通过之前的初始化或升级），即使代码中不存在对应的迁移文件。因此不能简单地按文件数量推断版本号
   - 如果版本号与用户数据库中已有记录冲突，升级提示将不会出现

5. **MySQL 迁移 SQL 注意事项**:
   - MySQL 不支持 `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` 语法
   - 需要使用条件检查来实现幂等性：
   ```sql
   SET @column_exists = (
     SELECT COUNT(*) FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
     AND TABLE_NAME = 'table_name'
     AND COLUMN_NAME = 'column_name'
   );
   SET @sql = IF(@column_exists = 0,
     'ALTER TABLE table_name ADD COLUMN column_name TYPE DEFAULT value',
     'SELECT 1'
   );
   PREPARE stmt FROM @sql;
   EXECUTE stmt;
   DEALLOCATE PREPARE stmt;
   ```

6. **检查清单**:
   - [ ] 创建迁移文件
   - [ ] 更新 MySQL schema (server/src/utils/schema.ts)
   - [ ] 更新 Supabase schema (src/lib/database/supabase-init-sql.ts)
   - [ ] 更新 Edge Function schema (supabase/functions/mysql-proxy/index.ts)
   - [ ] 更新 TypeScript 类型 (src/types/database.ts)
   - [ ] 在 migrations/index.ts 中注册迁移

## 工作流规范

1. **代码变更前确认分支**：在进行任何代码变更前，必须先提示用户当前所在的分支名称，确保用户知悉变更将应用到哪个分支

## 代码风格

- 使用 TypeScript
- 组件使用函数式组件 + Hooks
- 样式使用 Tailwind CSS

## 数据库查询规范

**性能优化原则**：

1. **禁止使用 SELECT ***：查询时必须明确指定需要的字段，避免传输不必要的数据
   ```typescript
   // ❌ 错误
   db.from('prompts').select('*')

   // ✅ 正确
   db.from('prompts').select('id, name, content, variables')
   ```

2. **批量查询优先**：当需要查询多个表时，使用批量查询接口减少网络请求
   ```typescript
   // ❌ 错误：多次独立请求
   const [a, b, c] = await Promise.all([
     db.from('table1').select('*'),
     db.from('table2').select('*'),
     db.from('table3').select('*'),
   ]);

   // ✅ 正确：使用批量查询（MySQL）
   const { data } = await mysqlAdapter.batchQuery([
     { key: 'a', table: 'table1', columns: 'id, name' },
     { key: 'b', table: 'table2', columns: 'id, value' },
   ]);
   ```

3. **按需加载字段**：根据实际使用场景选择字段
   - 列表页面：只查询展示需要的字段
   - 详情页面：查询完整字段
   - 大文本字段（如 content, model_output）：仅在需要时查询

