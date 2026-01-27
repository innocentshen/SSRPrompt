<div align="center">

# SSRPrompt

一个现代化的 AI Prompt 开发和评测平台，帮助开发者更高效地开发、测试和管理 AI Prompts。

简体中文 | [官网](https://www.ssrprompt.com)

[![License](https://img.shields.io/badge/license-GPL-blue.svg)](./LICENSE)

</div>

## v2.0 架构升级

SSRPrompt v2.0 采用全新的前后端分离架构，带来更好的安全性、可维护性和扩展性：

- **Monorepo 架构** - 使用 pnpm workspace 管理多包项目
- **API Key 加密存储** - AES-256-GCM 加密保护敏感信息
- **后端 AI 代理** - 所有 AI 调用通过后端代理，前端不接触 API Key
- **SSE 流式响应** - 支持实时流式输出，优化用户体验
- **多租户隔离** - 强制用户数据隔离，保障数据安全
- **PostgreSQL** - 统一使用 PostgreSQL 数据库

## 与 main 分支差异

> 当前分支为 v2.0 重构版本；与 `main` 分支（当前稳定版）的架构/部署方式不兼容。

| 维度 | `main`（稳定版） | 当前分支（v2.0） |
|------|------------------|------------------|
| 包管理 | npm | pnpm workspace |
| 代码结构 | 单仓前端 + 可选 `server/`（MySQL 代理） | Monorepo：`packages/client` + `packages/server` + `packages/shared` |
| 数据库 | Supabase（PostgreSQL）/ MySQL；支持 Demo 空间免配置体验 | 仅 PostgreSQL；Prisma 管理 Schema；提供旧版数据迁移脚本 |
| AI 调用与 Key | 主要由前端发起调用 | 统一由后端代理；API Key AES-256-GCM 加密存储；前端不接触 Key |
| 认证与会话 | 前端访问密码（`VITE_APP_PASSWORD`） | JWT 登录 + Refresh Token；Access Token 24h；Demo 有效期 7 天 |
| 配置方式 | 以设置页为主（数据库/服务商都可在前端配置） | 以服务端 `.env` 为主（`DATABASE_URL/JWT_SECRET/ENCRYPTION_KEY` 等） |
| 启动方式 | 可仅启动前端（Supabase/Demo），MySQL 才需要启动后端 | 需要启动后端（建议 `pnpm dev:all` 同时启动 client/server/worker） |

如果你在找 `main` 分支的 Supabase/MySQL/Docker/Vercel 等部署/配置说明，请切换到 `main` 分支查看对应文档。

## 功能特性

### 核心功能

- **Prompt 开发** - 可视化界面开发和管理 AI Prompts，支持变量、多轮对话、结构化输出
- **Prompt 列表快捷操作** - 支持一键复制 Prompt、删除（二次确认）
- **Prompt 创建向导** - AI 驱动的对话式 Prompt 创建流程，支持模板快速开始
- **评测中心** - 对 Prompts 进行系统化评测和对比，支持自定义评价标准和 AI 评分
- **历史记录** - 追踪和查看 Prompt 执行历史，包含 Token 消耗和延迟统计
- **智能优化** - AI 驱动的 Prompt 分析和优化建议

### 高级特性

- **多模型支持** - 支持 OpenAI、Anthropic、Google Gemini、OpenRouter 等多种 AI 服务商
- **推理模型支持** - 支持 Claude、DeepSeek R1 等推理模型的 Thinking 输出展示
- **附件支持** - 支持图片、PDF、文档等多种文件类型作为上下文（视觉模型）
- **版本管理** - Prompt 版本历史和对比功能
- **实时流式输出** - SSE 流式响应，支持中断和重试

### 平台特性

- **Demo 模式** - 无需配置即可快速体验系统（7天有效期）
- **多语言支持** - 支持简体中文、繁体中文、英文、日文
- **主题切换** - 支持明暗主题切换
- **JWT 认证** - 安全的用户认证机制

## 技术栈

### 前端 (packages/client)
- **框架**: React 18 + TypeScript
- **构建工具**: Vite 5
- **样式**: Tailwind CSS 3
- **状态管理**: Zustand
- **国际化**: i18next
- **UI 组件**: 自定义组件库 + Lucide React

### 后端 (packages/server)
- **框架**: Express.js + TypeScript
- **ORM**: Prisma
- **数据库**: PostgreSQL
- **认证**: JWT
- **加密**: AES-256-GCM

### 共享 (packages/shared)
- **类型定义**: TypeScript
- **验证**: Zod
- **错误码**: 统一错误处理

## 快速开始

### 环境要求

- Node.js >= 18
- pnpm >= 8
- PostgreSQL >= 14

### 安装

```bash
# 克隆项目
git clone https://github.com/innocentshen/ssrprompt.git
cd ssrprompt

# 安装依赖
pnpm install
```

### 配置

```bash
# 复制环境变量模板
cp packages/server/.env.example packages/server/.env

# 编辑配置文件
# 设置 DATABASE_URL, JWT_SECRET, ENCRYPTION_KEY
```

**必需的环境变量：**

```env
# 数据库连接
DATABASE_URL=postgresql://postgres:password@localhost:5432/ssrprompt

# JWT 密钥（至少32字符）
JWT_SECRET=your-jwt-secret-at-least-32-characters-long

# 加密密钥（64位十六进制字符串）
ENCRYPTION_KEY=your-64-character-hex-string-for-aes-256-encryption

# 可选：用于 seed 创建管理员账号
ADMIN_EMAIL=admin@example.com
ADMIN_PASSWORD=ChangeMe123!

# 生成 ENCRYPTION_KEY:
# node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### 初始化数据库

```bash
# 生成 Prisma Client
pnpm db:generate

# 推送数据库 Schema
pnpm db:push

# 可选：打开 Prisma Studio
pnpm db:studio

# 可选：初始化系统角色/权限，并创建管理员账号（需先配置 ADMIN_EMAIL / ADMIN_PASSWORD）
pnpm --filter @ssrprompt/server prisma:seed
```

### 启动开发服务器

```bash
# 同时启动前端和后端（推荐）
pnpm dev:all          # 同时启动 client/server/worker

# 或分别启动
pnpm dev          # 前端 http://localhost:5173
pnpm dev:server   # 后端 http://localhost:3001
pnpm dev:worker       # 启动 worker
```

## 项目结构

```
ssrprompt/
├── packages/
│   ├── client/                    # 前端 React 应用
│   │   ├── src/
│   │   │   ├── api/               # API Client
│   │   │   │   ├── client.ts      # HTTP 客户端
│   │   │   │   ├── providers.ts   # 服务商 API
│   │   │   │   ├── prompts.ts     # Prompt API
│   │   │   │   ├── evaluations.ts # 评测 API
│   │   │   │   ├── traces.ts      # 追踪 API
│   │   │   │   └── chat.ts        # 流式聊天 API
│   │   │   ├── components/        # UI 组件
│   │   │   ├── pages/             # 页面组件
│   │   │   ├── store/             # Zustand Store
│   │   │   └── locales/           # 多语言文件
│   │   ├── public/                # 静态资源
│   │   ├── index.html
│   │   ├── vite.config.ts
│   │   └── package.json
│   │
│   ├── server/                    # 后端 Express 应用
│   │   ├── src/
│   │   │   ├── config/            # 配置
│   │   │   │   ├── env.ts         # 环境变量验证
│   │   │   │   └── database.ts    # 数据库连接
│   │   │   ├── controllers/       # 控制器
│   │   │   ├── services/          # 业务逻辑
│   │   │   ├── repositories/      # 数据访问层
│   │   │   ├── routes/            # 路由定义
│   │   │   ├── middleware/        # 中间件
│   │   │   │   ├── auth.ts        # JWT 认证
│   │   │   │   ├── cors.ts        # CORS 配置
│   │   │   │   └── error-handler.ts
│   │   │   └── utils/             # 工具函数
│   │   │       ├── crypto.ts      # 加密工具
│   │   │       └── transform.ts   # 数据转换
│   │   ├── prisma/
│   │   │   └── schema.prisma      # 数据库 Schema
│   │   ├── scripts/
│   │   │   └── migrate-data.ts    # 数据迁移脚本
│   │   └── package.json
│   │
│   └── shared/                    # 共享代码
│       └── src/
│           ├── types/             # 类型定义
│           ├── schemas/           # Zod 验证 Schema
│           ├── errors/            # 错误码定义
│           └── constants/         # 常量
│
├── package.json                   # Monorepo 根配置
├── pnpm-workspace.yaml            # pnpm workspace
└── tsconfig.base.json             # 共享 TS 配置
```

## API 文档

推荐以 Swagger 为准：`http://localhost:3001/api-docs`

### 认证

```
POST /api/v1/auth/register          # 用户注册
POST /api/v1/auth/login             # 用户登录
POST /api/v1/auth/logout            # 退出登录
POST /api/v1/auth/refresh           # 刷新 Token
GET  /api/v1/auth/me                # 获取当前用户
POST /api/v1/auth/change-password   # 修改密码
GET  /api/v1/auth/demo-token        # 获取 Demo Token
```

### 服务商和模型

```
GET    /api/v1/providers              # 获取服务商列表
POST   /api/v1/providers              # 创建服务商
GET    /api/v1/providers/:id          # 获取服务商详情
PUT    /api/v1/providers/:id          # 更新服务商
DELETE /api/v1/providers/:id          # 删除服务商

GET    /api/v1/models                 # 获取所有模型
GET    /api/v1/providers/:id/models   # 获取服务商的模型
POST   /api/v1/providers/:id/models   # 添加模型
PUT    /api/v1/models/:id             # 更新模型
DELETE /api/v1/models/:id             # 删除模型
```

### Prompts

```
GET    /api/v1/prompts                # 获取 Prompt 列表
POST   /api/v1/prompts                # 创建 Prompt
GET    /api/v1/prompts/:id            # 获取 Prompt 详情
PUT    /api/v1/prompts/:id            # 更新 Prompt
DELETE /api/v1/prompts/:id            # 删除 Prompt

GET    /api/v1/prompts/:id/versions   # 获取版本历史
POST   /api/v1/prompts/:id/versions   # 创建新版本
```

### 评测

```
GET    /api/v1/evaluations            # 获取评测列表
POST   /api/v1/evaluations            # 创建评测
GET    /api/v1/evaluations/:id        # 获取评测详情
PUT    /api/v1/evaluations/:id        # 更新评测
DELETE /api/v1/evaluations/:id        # 删除评测
POST   /api/v1/evaluations/:id/copy   # 复制评测

POST   /api/v1/evaluations/:id/test-cases   # 创建测试用例
POST   /api/v1/evaluations/:id/criteria     # 创建评价标准
POST   /api/v1/evaluations/:id/runs         # 创建运行记录
```

### 聊天（流式）

```
POST   /api/v1/chat/completions       # 聊天补全（支持 SSE 流式）
```

### 追踪和统计

```
GET    /api/v1/traces                 # 获取追踪列表（分页）
POST   /api/v1/traces                 # 创建追踪记录
DELETE /api/v1/traces/:id             # 删除追踪

GET    /api/v1/stats/usage            # 获取使用统计
```

## 数据库 Schema

项目使用 Prisma ORM，包含以下数据表：

| 表名 | 说明 |
|------|------|
| `providers` | AI 服务商配置（API Key 加密存储） |
| `models` | 模型信息 |
| `prompts` | Prompt 管理 |
| `prompt_versions` | Prompt 版本历史 |
| `evaluations` | 评测项目 |
| `test_cases` | 测试用例 |
| `evaluation_criteria` | 评价标准 |
| `evaluation_runs` | 评测运行记录 |
| `test_case_results` | 测试结果 |
| `traces` | 调用追踪日志 |

## 可用脚本

```bash
# 开发
pnpm dev              # 启动前端
pnpm dev:server       # 启动后端
pnpm dev:worker       # 启动 worker
pnpm dev:all          # 同时启动 client/server/worker

# 构建
pnpm build            # 构建前端
pnpm build:server     # 构建后端
pnpm build:all        # 构建全部

# 数据库
pnpm db:generate      # 生成 Prisma Client
pnpm db:push          # 推送 Schema 到数据库
pnpm db:migrate       # 运行数据库迁移
pnpm db:studio        # 打开 Prisma Studio

# 代码质量
pnpm lint             # ESLint 检查
pnpm typecheck        # TypeScript 类型检查
```

## 数据迁移

从旧版本迁移数据：

```bash
# 设置环境变量
export OLD_DATABASE_URL="mysql://..."    # 旧数据库
export DATABASE_URL="postgresql://..."   # 新数据库
export ENCRYPTION_KEY="..."              # 加密密钥

# 运行迁移脚本
cd packages/server
npx tsx scripts/migrate-data.ts
```

迁移脚本会：
- 迁移所有实体（Providers, Models, Prompts, Evaluations, Traces）
- 使用 AES-256-GCM 加密 API Keys
- 保留外键关系
- 生成迁移报告

## 安全特性

### API Key 加密

所有 API Key 使用 AES-256-GCM 对称加密存储：

```typescript
// 加密格式: iv:authTag:encrypted (十六进制)
const encrypted = encrypt(apiKey);
const decrypted = decrypt(encrypted);
```

### JWT 认证

- Access Token 有效期：24h（通过 Refresh Token 自动续签）
- Refresh Token 有效期：7 天
- Demo 空间有效期：7 天（Demo Token 自动续期，超期需重置）

### 多租户隔离

所有数据查询强制包含 `userId` 过滤：

```typescript
// TenantRepository 基类强制用户隔离
async findAll(userId: string) {
  return this.prisma.findMany({
    where: { userId }
  });
}
```

### 环境变量验证

服务器启动时使用 Zod 验证必需的环境变量：

```typescript
const envSchema = z.object({
  DATABASE_URL: z.string().url(),
  JWT_SECRET: z.string().min(32),
  ENCRYPTION_KEY: z.string().length(64),
});
```

## 部署

### 部署架构

- **前端（Web）**：静态资源（`pnpm build` 输出到 `packages/client/dist`），可部署到 Nginx / Vercel / OSS 等
- **后端（API）**：Node.js + Express（默认 `:3001`）
- **数据库**：PostgreSQL（必需）
- **对象存储**：S3 兼容（可选，但启用附件/文件上传功能需要；可用 MinIO / AWS S3 / Cloudflare R2 等）

> 现在还要部署 MinIO 吗？
>
> - **需要上传/预览附件（图片、PDF、文件等）**：需要配置 S3 兼容对象存储（可自建 MinIO，也可用云厂商 S3/R2）
> - **不使用附件功能**：可以不部署/不配置对象存储；服务仍可启动，但与文件相关的接口会报 `S3 storage is not configured`

### 环境变量配置

生产环境后端（`packages/server`）必须配置：

```env
NODE_ENV=production
DATABASE_URL=postgresql://...
JWT_SECRET=<强随机字符串，至少32字符>
ENCRYPTION_KEY=<64位十六进制字符串>
CORS_ORIGIN=https://your-domain.com

# 可选：用于 seed 创建管理员账号
ADMIN_EMAIL=admin@example.com
ADMIN_PASSWORD=ChangeMe123!

# 可选：对象存储（S3 兼容；启用附件/文件上传必填）
S3_ENDPOINT=https://minio.your-domain.com
S3_BUCKET=ssrprompt
S3_ACCESS_KEY_ID=your-access-key
S3_SECRET_ACCESS_KEY=your-secret-key
S3_REGION=us-east-1
S3_FORCE_PATH_STYLE=true
```

前端（`packages/client`）在构建时配置：

```env
VITE_API_URL=https://api.your-domain.com/api/v1
```

### 构建

```bash
# 构建前端
pnpm build

# 构建后端
pnpm build:server
```

### 启动

```bash
# 初始化数据库（首次部署）
pnpm db:generate
pnpm db:push

# 可选：初始化系统角色/权限，并创建管理员账号（需先配置 ADMIN_EMAIL / ADMIN_PASSWORD）
pnpm --filter @ssrprompt/server prisma:seed

# 启动后端
pnpm --filter @ssrprompt/server start
```

## 开发指南

### 添加新 API

1. 在 `packages/shared/src/types/` 添加类型定义
2. 在 `packages/shared/src/schemas/` 添加 Zod 验证
3. 在 `packages/server/src/repositories/` 添加数据访问层
4. 在 `packages/server/src/services/` 添加业务逻辑
5. 在 `packages/server/src/controllers/` 添加控制器
6. 在 `packages/server/src/routes/` 添加路由
7. 在 `packages/client/src/api/` 添加前端 API 客户端

### 代码规范

```bash
pnpm lint        # ESLint 检查
pnpm typecheck   # TypeScript 类型检查
```

## 许可证

GPL

## 贡献

欢迎提交 Issue 和 Pull Request！

## 相关链接

- [开发规范](./CLAUDE.md)
