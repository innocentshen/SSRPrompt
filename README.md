<div align="center">

# SSRPrompt

一个面向生产的 AI Prompt 开发、评测与发布平台（v2.0）。

简体中文 | [繁體中文](./README_ZH_TW.md) | [English](./README_EN.md) | [日本語](./README_JA.md) | [官网](https://www.ssrprompt.com)

[![License](https://img.shields.io/badge/license-GPL-blue.svg)](./LICENSE)

</div>

## 项目说明

- 当前仓库是 **v2.0 重构架构**（`packages/client` + `packages/server` + `packages/shared`）。
- 与 `main` 分支（旧部署模型）不兼容；请按本 README 的方式部署。
- 后端统一使用 PostgreSQL + Prisma，前端不直接持有模型 API Key。

## 当前版本核心能力（按代码现状）

### Prompt 全链路

- Prompt 工作区：多轮消息、变量、结构化输出、参数配置、版本管理。
- Prompt 分组：支持分组管理与排序。
- Prompt 广场：公开 Prompt 浏览、复制、版本查看。
- Prompt API：支持创建 API Key，并通过开放接口调用指定 Prompt。

### 评测与分析

- 评测中心：评测集、测试用例、评价标准、运行记录。
- 运行控制：执行、中止、结果批量写入。
- 导入导出：评测模板下载、ZIP 导入、评测导出。
- 分析报告：支持保存单次/多次运行分析报告。

### 多模态与可观测

- Chat SSE 流式输出，支持 reasoning/thinking 展示。
- 文件上传与附件使用（依赖 S3 兼容对象存储）。
- OCR 能力（`paddle` / `paddle_vl` / `paddle_vl_1_5` / `datalab` / `mineru`）。
- Trace 追踪：输入输出、耗时、Token、附件与 OCR 信息。

### 安全与平台

- JWT + Refresh Token 登录体系，支持 Demo Token。
- API Key AES-256-GCM 加密存储。
- 私有分享链接（Prompt / Evaluation）+ 密码校验 + 访问日志。
- OAuth（Google / Linux.do）、邮箱验证码与找回密码。
- 管理员用户管理（角色、状态、账号管理）。

## 页面与路由

| 页面 | 路由 |
|---|---|
| 首页 | `/` |
| Prompt 向导 | `/wizard` |
| Prompt 广场 | `/plaza` |
| Prompt 工作区 | `/prompts` |
| 评测中心 | `/evaluation` |
| 调用追踪 | `/traces` |
| 设置 | `/settings` |
| 登录 / 找回密码 | `/login` / `/forgot-password` |
| 分享页 | `/share/p/:token` / `/share/e/:token` |

## 技术栈

- 前端：React 18 + TypeScript + Vite + Tailwind + Zustand + i18next
- 后端：Express + TypeScript + Prisma + PostgreSQL + Graphile Worker
- 共享：`@ssrprompt/shared`（类型、Schema、错误码）

---

## 快速开始（本地开发）

### 1) 环境要求

- Node.js >= 18
- pnpm >= 8
- PostgreSQL >= 14

### 2) 安装依赖

```bash
git clone https://github.com/innocentshen/ssrprompt.git
cd ssrprompt
pnpm install
```

### 3) 配置环境变量

```bash
cp packages/server/.env.example packages/server/.env
```

最低必填（`packages/server/.env`）：

```env
DATABASE_URL=postgresql://postgres:password@localhost:5432/ssrprompt?schema=public
JWT_SECRET=your-jwt-secret-at-least-32-characters-long
ENCRYPTION_KEY=your-64-character-hex-string-for-aes-256-encryption
```

生成 `ENCRYPTION_KEY`：

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### 4) 初始化数据库

```bash
pnpm db:generate
pnpm db:deploy        # 推荐：按 migration 执行
# pnpm db:push         # 仅开发场景可选
pnpm --filter @ssrprompt/server prisma:seed   # 可选：初始化角色与管理员
```

### 5) 启动

```bash
pnpm dev:all          # 同时启动 client/server/worker（推荐）

# 或分开启动
pnpm dev              # 前端:  http://localhost:5173
pnpm dev:server       # API:   http://localhost:3001
pnpm dev:worker       # Worker
```

Swagger 文档：`http://localhost:3001/api-docs`

---

## 线上数据库结构升级（重点）

仓库已内置目标库迁移脚本（支持传入任意 `DATABASE_URL`）：

```bash
# 常规：对目标库执行 migrate deploy + status
pnpm db:deploy:target -- --database-url "postgresql://user:password@host:port/dbname"

# 历史库有迁移记录漂移时：先 resolve 再 deploy
pnpm db:deploy:target:resolve -- --database-url "postgresql://user:password@host:port/dbname"
```

当你遇到类似 `column ... does not exist` 的 Prisma 报错时，优先执行上述命令。

---

## 评测队列与 Worker 运行模式

`EVALUATION_QUEUE_DRIVER` 支持两种模式：

- `memory`（默认）：进程内队列，适合开发/轻量场景。
- `pg`：基于 Graphile Worker，适合生产。

生产建议：

1. 设置 `EVALUATION_QUEUE_DRIVER=pg`
2. 首次执行一次 worker schema 初始化：

```bash
pnpm --filter @ssrprompt/server worker:setup
```

3. 分别运行 API 与 Worker：

```bash
pnpm --filter @ssrprompt/server start
pnpm --filter @ssrprompt/server start:worker
```

---

## Docker 部署（双服务）

仓库内提供两个 Dockerfile：

- `Dockerfile.ssrprompt-api`
- `Dockerfile.ssrprompt-worker`

构建镜像：

```bash
docker build -f Dockerfile.ssrprompt-api -t <dockerhub_user>/ssrprompt-api:latest .
docker build -f Dockerfile.ssrprompt-worker -t <dockerhub_user>/ssrprompt-worker:latest .
```

运行镜像：

```bash
# API
docker run -d --name ssrprompt-api -p 3001:3001 --env-file packages/server/.env <dockerhub_user>/ssrprompt-api:latest

# Worker
docker run -d --name ssrprompt-worker --env-file packages/server/.env <dockerhub_user>/ssrprompt-worker:latest
```

如果使用 Zeabur/GitHub 仓库构建，API 与 Worker 需配置不同启动命令：

- API：`node packages/server/dist/index.js`
- Worker：`node packages/server/dist/worker.js`

---

## 关键环境变量（后端）

### 基础必需

- `NODE_ENV`
- `PORT`（默认 `3001`）
- `DATABASE_URL`
- `JWT_SECRET`
- `ENCRYPTION_KEY`
- `CORS_ORIGIN`

### 常用可选

- 注册与认证：`ALLOW_REGISTRATION`、`REQUIRE_EMAIL_VERIFICATION`
- SMTP：`SMTP_HOST` `SMTP_PORT` `SMTP_USER` `SMTP_PASS` `SMTP_FROM`
- OAuth：`OAUTH_GOOGLE_*`、`OAUTH_LINUXDO_*`
- S3：`S3_ENDPOINT` `S3_BUCKET` `S3_ACCESS_KEY_ID` `S3_SECRET_ACCESS_KEY` `S3_REGION`
- 限流：`RATE_LIMIT_WINDOW_MS` `RATE_LIMIT_MAX_REQUESTS`
- 评测队列：`EVALUATION_QUEUE_DRIVER` 及 `EVALUATION_*` 并发/批次参数

完整示例请看：`packages/server/.env.example`

---

## API 概览（v1）

基础前缀：`/api/v1`

- 认证：`/auth/*`（注册、登录、刷新、OAuth、找回密码、Demo）
- 健康检查：`/health`
- Prompt：`/prompts`、`/prompt-groups`
- 模型：`/providers`、`/models`
- 聊天：`/chat/completions`
- 评测：`/evaluations`、`/runs`、`/test-cases`、`/criteria`
- 导入导出：`/evaluation-imports`
- 文件与 OCR：`/files`、`/ocr`
- 分享：`/share-links`、`/share`
- Prompt API：`/prompt-api-keys`、`/open/prompts/:promptId/invoke`
- 追踪统计：`/traces`、`/stats/usage`
- 管理员：`/users`

以 Swagger 为准：`/api-docs`

---

## 常用命令

```bash
# 开发
pnpm dev
pnpm dev:server
pnpm dev:worker
pnpm dev:all

# 构建
pnpm build
pnpm build:server
pnpm build:all

# 数据库
pnpm db:generate
pnpm db:migrate
pnpm db:deploy
pnpm db:deploy:target
pnpm db:deploy:target:resolve
pnpm db:studio

# 质量
pnpm lint
pnpm typecheck
```

---

## 许可证

GPL

## 贡献

欢迎提交 Issue / PR。

## 相关文档

- [README_EN.md](./README_EN.md)
- [README_ZH_TW.md](./README_ZH_TW.md)
- [README_JA.md](./README_JA.md)
- [开发规范](./CLAUDE.md)
