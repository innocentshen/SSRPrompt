# SSRPrompt Supabase 配置指南

本指南将帮助你快速配置和测试 Supabase 作为 SSRPrompt 的数据库后端。

## 目录

- [什么是 Supabase](#什么是-supabase)
- [创建 Supabase 项目](#创建-supabase-项目)
- [配置数据库](#配置数据库)
- [获取连接信息](#获取连接信息)
- [配置本地项目](#配置本地项目)
- [测试连接](#测试连接)
- [数据库管理](#数据库管理)
- [常见问题](#常见问题)

## 什么是 Supabase

Supabase 是一个开源的 Firebase 替代品，提供：
- ✅ PostgreSQL 数据库（完全托管）
- ✅ 自动生成的 REST API
- ✅ 实时订阅功能
- ✅ 内置身份验证
- ✅ 行级安全策略（RLS）
- ✅ 免费额度：500MB 数据库 + 5GB 带宽/月

## 创建 Supabase 项目

### 1. 注册账号

访问 [https://supabase.com](https://supabase.com) 并注册账号（支持 GitHub 登录）

### 2. 创建新项目

1. 点击 "New Project"
2. 选择组织（或创建新组��）
3. 填写项目信息：
   - **Name**: `promptgo`（或你喜欢的名字）
   - **Database Password**: 生成一个强密码（记得保存！）
   - **Region**: 选择离你最近的区域（建议：新加坡、东京或香港）
   - **Pricing Plan**: 选择 `Free` 计划

4. 点击 "Create new project"，等待 1-2 分钟初始化

## 配置数据库

### 方式 1：使用 Supabase Migration（推荐）

1. 安装 Supabase CLI：

```bash
# macOS/Linux
brew install supabase/tap/supabase

# Windows (使用 Scoop)
scoop bucket add supabase https://github.com/supabase/scoop-bucket.git
scoop install supabase

# 或使用 npm
npm install -g supabase
```

2. 登录 Supabase：

```bash
supabase login
```

3. 链接到你的项目：

```bash
cd /path/to/promptgo
supabase link --project-ref your-project-ref
```

> **提示**：在 Supabase Dashboard 的 Settings > General 中找到 `Reference ID`

4. 推送数据库迁移：

```bash
supabase db push
```

这将自动应用 `supabase/migrations/` 目录下的所有迁移文件。

### 方式 2：手动执行 SQL（快速测试）

1. 在 Supabase Dashboard 中，点击左侧菜单的 **SQL Editor**

2. 按顺序执行以下迁移文件（复制粘贴内容到 SQL 编辑器）：

```
supabase/migrations/
├── 20251219040434_001_initial_schema.sql        ← 先执行
├── 20251219045832_002_demo_access_policies.sql  ← 然后
├── 20251219053844_003_evaluation_test_cases.sql ← 依次
├── 20251219061032_004_remove_weight_constraint.sql
├── 20251219062606_005_evaluation_runs.sql
├── 20251219063235_006_evaluation_runs_demo_policy.sql
├── 20251219064937_007_prompt_default_model_and_order.sql
└── 20251220032002_008_evaluation_run_tokens.sql  ← 最后
```

3. 点击 "Run" 执行每个文件

### 验证数据库

在 SQL Editor 中运行：

```sql
-- 查看所有表
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public';

-- 应该看到以下表：
-- providers, models, prompts, prompt_versions
-- evaluations, evaluation_test_cases, evaluation_runs
-- traces
```

## 获取连接信息

### 1. 获取 Project URL 和 API Key

在 Supabase Dashboard：

1. 点击左侧的 **Settings** (齿轮图标)
2. 选择 **API**
3. 复制以下信息：

```
Project URL:     https://xxxxxxxxxxxxx.supabase.co
anon public key: eyJhbGc...很长的字符串
```

### 2. API Keys 说明

Supabase 提供两个密钥：

| 密钥 | 用途 | 是否安全暴露 |
|------|------|--------------|
| `anon` (public) | 客户端使用 | ✅ 安全（受 RLS 保护） |
| `service_role` | 服务端使用 | ❌ 不可暴露（绕过 RLS） |

**在前端应用中使用 `anon` key**，它受行级安全策略（RLS）保护。

## 配置本地项目

### 1. 更新环境变量

编辑项目根目录的 `.env` 文件（如果没有则创建）：

```bash
# Supabase 配置
VITE_SUPABASE_URL=https://xxxxxxxxxxxxx.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...

# 应用访问密码
VITE_APP_PASSWORD=admin123

# 如果同时配置了 MySQL，注释掉以优先使用 Supabase
# VITE_MYSQL_PROXY_URL=http://localhost:3001/api/mysql-proxy
# VITE_MYSQL_PROXY_API_KEY=your_api_key
```

### 2. 重启开发服务器

```bash
# 停止当前服务（如果正在运行）
# Ctrl+C

# 只启动前端（不需要后端和 MySQL）
npm run dev
```

访问 http://localhost:5173

## 测试连接

### 方法 1：在应用中测试

1. 打开应用 http://localhost:5173
2. 使用密码登录（默认：`admin123`）
3. 点击左下角的 **设置** 按钮
4. 在 **数据库设置** 区域：
   - **提供商** 选择 `Supabase`
   - 点击 **测试连接** 按钮
   - 如果显示 "连接成功"，说明配置正确！

### 方法 2：使用开发者工具测试

打开浏览器控制台（F12），运行：

```javascript
// 测试 Supabase 连接
const { createClient } = await import('@supabase/supabase-js');
const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY
);

// 查询 providers 表
const { data, error } = await supabase.from('providers').select('*').limit(1);
console.log('Data:', data);
console.log('Error:', error);

// 如果返回 data (即使是空数组) 且 error 为 null，说明连接成功
```

### 方法 3：使用 Supabase CLI 测试

```bash
# 查询数据库
supabase db remote commit

# 查看表结构
supabase db diff
```

## 在应用中���用 Supabase

### 切换到 Supabase

1. 登录应用
2. 进入 **设置** 页面
3. 在 **数据库设置** 中：
   - 选择 `Supabase` 作为提供商
   - 点击 **保存配置**
4. 刷新页面

现在所有数据都将存储到 Supabase！

### 验证数据存储

1. 在应用中创建一个 Prompt
2. 在 Supabase Dashboard 中：
   - ��击 **Table Editor**
   - 选择 `prompts` 表
   - 应该能看到你刚创建的数据

## 数据库管理

### 在线管理（Supabase Dashboard）

1. **Table Editor** - 可视化编辑数据
   - 增删改查数据
   - 修改表结构
   - 查看外键关系

2. **SQL Editor** - 执行 SQL 查询
   - 运行自定义 SQL
   - 保存常用查询
   - 查看执行历史

3. **Database** - 数据库管理
   - 查看表结构
   - 管理索引
   - 配置扩展

### 本地管理（Supabase CLI）

```bash
# 本地启动 Supabase（可选）
supabase start

# 查看本地状态
supabase status

# 停止本地服务
supabase stop

# 重置数据库
supabase db reset
```

### 备份数据

#### 方法 1：使用 Dashboard

1. Settings > Database
2. 点击 "Download backup"
3. 选择备份时间点

#### 方法 2：使用 pg_dump

```bash
# 获取数据库连接字符串（Settings > Database > Connection string）
pg_dump "postgresql://postgres:[PASSWORD]@db.xxxxx.supabase.co:5432/postgres" > backup.sql

# 恢复备份
psql "postgresql://postgres:[PASSWORD]@db.xxxxx.supabase.co:5432/postgres" < backup.sql
```

## 性能优化

### 1. 启用缓存

在查询中使用 `.limit()` 和 `.order()` 以利用索引：

```javascript
const { data } = await supabase
  .from('prompts')
  .select('*')
  .order('created_at', { ascending: false })
  .limit(10);
```

### 2. 使用 RLS (Row Level Security)

项目已经配置了 RLS，确保：
- 用户只能访问自己的数据
- 防止未授权访问

### 3. 监控性能

在 Dashboard > Reports 查看：
- API 请求量
- 数据库大小
- 慢查询分析

## 从 MySQL 迁移到 Supabase

如果你之前使用 MySQL，可以这样迁移数据：

### 1. 导出 MySQL 数据

```bash
docker-compose exec mysql mysqldump -u root -p promptgo > mysql_data.sql
```

### 2. 转换和导入

由于 MySQL 和 PostgreSQL 语法差异，需要手动调整 SQL 或编写脚本。

**建议**：先在 Supabase 中手动重新创建数据，或使用应用界面导入。

## 常见问题

### Q1: 提示 "Invalid API key"

**解决方案**：
1. 检查 `.env` 文件中的 `VITE_SUPABASE_URL` 和 `VITE_SUPABASE_ANON_KEY`
2. 确保使用的是 `anon` key，不是 `service_role` key
3. 重启开发服务器：`npm run dev`

### Q2: 查询返回空数组但应该有数据

**原因**：Row Level Security (RLS) 策略阻止了访问

**解决方案**：
1. 在 Supabase Dashboard 查看 Authentication > Users
2. 项目使用本地密码认证，不通过 Supabase Auth
3. 检查 SQL Editor 中的 RLS 策略是否正确

### Q3: 表不存在

**解决方案**：
1. 确认已执行所有迁移文件
2. 在 SQL Editor 运行：`SELECT * FROM information_schema.tables WHERE table_schema = 'public';`
3. 如果表缺失，重新执行对应的迁移文件

### Q4: 连接超时

**解决方案**：
1. 检查网络连接
2. 确认 Supabase 项目状态（不是 Paused）
3. 检查防火墙设置

### Q5: 免费额度不够用

Supabase 免费计划限制：
- ✅ 500 MB 数据库存储
- ✅ 5 GB 带宽/月
- ✅ 500 MB 文件存储

**解决方案**：
- 定期清理 `traces` 表的历史数据
- 升级到 Pro 计划（$25/月）
- 或切换回本地 MySQL

### Q6: 如何在 Supabase 和 MySQL 之间切换？

在应用的 **设置** 页面：
1. 选择数据库提供商（Supabase 或 MySQL）
2. 点击保存
3. 刷新页面

数据是独立存储的，不会自动同步！

## 生产环境部署

### 环境变量配置

在生产环境（如 Vercel、Netlify）配置：

```
VITE_SUPABASE_URL=your_production_supabase_url
VITE_SUPABASE_ANON_KEY=your_production_anon_key
VITE_APP_PASSWORD=your_secure_password
```

### 安全建议

1. ✅ 使用单独的 Supabase 项目用于生产环境
2. ✅ 定期备份数据
3. ✅ 启用 2FA 保护 Supabase 账号
4. ✅ 监控 API 使用量
5. ✅ 不要在代码中硬编码密钥

## 更多资源

- [Supabase 官方文档](https://supabase.com/docs)
- [PostgreSQL 教程](https://www.postgresql.org/docs/)
- [Row Level Security 指南](https://supabase.com/docs/guides/auth/row-level-security)
- [Supabase CLI 文档](https://supabase.com/docs/guides/cli)

## 获取帮助

如遇到问题：
1. 查看本文档的常见问题部分
2. 查看 Supabase Dashboard 的日志
3. 检查浏览器控制台错误
4. 提交 Issue 到项目仓库
