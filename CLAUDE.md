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

4. **检查清单**:
   - [ ] 创建迁移文件
   - [ ] 更新 MySQL schema (server/src/utils/schema.ts)
   - [ ] 更新 Supabase schema (src/lib/database/supabase-init-sql.ts)
   - [ ] 更新 Edge Function schema (supabase/functions/mysql-proxy/index.ts)
   - [ ] 更新 TypeScript 类型 (src/types/database.ts)
   - [ ] 在 migrations/index.ts 中注册迁移

## 代码风格

- 使用 TypeScript
- 组件使用函数式组件 + Hooks
- 样式使用 Tailwind CSS
