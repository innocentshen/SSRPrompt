# SSRPrompt 环境变量说明（后端）

本文对应 `packages/server/.env.example`，用于帮助部署和运维快速理解每个变量。

## 使用方式

1. 复制模板：`cp packages/server/.env.example packages/server/.env`
2. 先填「必填项」：数据库、JWT、加密密钥、管理员账号、S3（若使用附件）
3. 生产环境建议启用：`EVALUATION_QUEUE_DRIVER=pg`，并单独运行 worker

## 变量分组

### 1) Server / Database

| 变量 | 必填 | 默认值 | 说明 |
|---|---|---|---|
| `NODE_ENV` | 是 | `development` | 运行环境：`development` / `production` / `test` |
| `PORT` | 是 | `3001` | API 服务监听端口 |
| `DATABASE_URL` | 是 | 示例值 | PostgreSQL 连接串 |
| `GRAPHILE_WORKER_SCHEMA` | 建议 | `graphile_worker` | Graphile Worker 使用的 schema 名称 |

### 2) 认证与安全

| 变量 | 必填 | 默认值 | 说明 |
|---|---|---|---|
| `JWT_SECRET` | 是 | 无 | JWT 签名密钥，至少 32 字符 |
| `ENCRYPTION_KEY` | 是 | 无 | AES-256-GCM 密钥，64 位十六进制字符串 |
| `CORS_ORIGIN` | 是 | `http://localhost:5173,http://localhost:3000` | 允许跨域来源，逗号分隔 |
| `RATE_LIMIT_WINDOW_MS` | 否 | `60000` | 全局限流窗口（毫秒） |
| `RATE_LIMIT_MAX_REQUESTS` | 否 | `300` | 每个窗口最大请求数 |

### 3) 注册与初始化

| 变量 | 必填 | 默认值 | 说明 |
|---|---|---|---|
| `ALLOW_REGISTRATION` | 否 | `true` | 是否允许注册 |
| `REQUIRE_EMAIL_VERIFICATION` | 否 | `false` | 注册时是否强制邮箱验证码 |
| `AUTO_SEED_ON_STARTUP` | 否 | `true` | 启动时自动初始化角色/权限/管理员 |
| `ADMIN_EMAIL` | 是 | `admin@example.com` | 管理员邮箱（自动种子使用） |
| `ADMIN_PASSWORD` | 是 | `change-this-password` | 管理员密码（自动种子使用） |

### 4) S3 文件存储（附件/文件/OCR 依赖）

| 变量 | 必填 | 默认值 | 说明 |
|---|---|---|---|
| `S3_ENDPOINT` | 视场景 | 示例值 | S3/MinIO 地址 |
| `S3_BUCKET` | 视场景 | 示例值 | 存储桶名 |
| `S3_ACCESS_KEY_ID` | 视场景 | 示例值 | Access Key |
| `S3_SECRET_ACCESS_KEY` | 视场景 | 示例值 | Secret Key |
| `S3_REGION` | 否 | `us-east-1` | 区域 |
| `S3_FORCE_PATH_STYLE` | 否 | `true` | MinIO 常用为 `true` |

说明：若不使用附件上传/文件处理/OCR，可先不配置 S3；一旦启用相关功能，需要完整配置。

### 5) 评测队列与 Worker

| 变量 | 必填 | 默认值 | 说明 |
|---|---|---|---|
| `EVALUATION_QUEUE_DRIVER` | 建议 | `pg` | 队列驱动：`pg`（默认，推荐）或 `memory` |
| `EVALUATION_RUN_CONCURRENCY` | 否 | `5` | 同进程并发运行的评测任务数 |
| `EVALUATION_CASE_CONCURRENCY` | 否 | `5` | 单次评测中测试用例并发度 |
| `EVALUATION_RESULT_BATCH_SIZE` | 否 | `20` | 结果批量落库阈值 |
| `EVALUATION_ABORT_CHECK_INTERVAL_MS` | 否 | `2000` | 中断状态检查间隔 |
| `EVALUATION_WORKER_POLL_INTERVAL_MS` | 否 | `1000` | Worker 拉取任务间隔 |
| `EVALUATION_PROGRESS_UPDATE_INTERVAL_MS` | 否 | `1000` | 进度写回最小间隔 |
| `EVALUATION_PROGRESS_UPDATE_BATCH_SIZE` | 否 | `1` | 进度写回批次阈值 |

### 6) 队列恢复（仅 `pg` 队列）

| 变量 | 必填 | 默认值 | 说明 |
|---|---|---|---|
| `EVALUATION_QUEUE_RECOVERY_ENABLED` | 否 | `true` | 是否启用 pending 任务自恢复 |
| `EVALUATION_QUEUE_RECOVERY_INTERVAL_MS` | 否 | `15000` | 恢复扫描周期 |
| `EVALUATION_QUEUE_RECOVERY_MIN_PENDING_AGE_MS` | 否 | `20000` | 多久未处理才视为“卡住” |
| `EVALUATION_QUEUE_RECOVERY_RUN_BATCH_SIZE` | 否 | `50` | 每轮最多恢复 run 任务数 |
| `EVALUATION_QUEUE_RECOVERY_IMPORT_BATCH_SIZE` | 否 | `20` | 每轮最多恢复 import 任务数 |

### 7) 评测导入与文件大小限制

| 变量 | 必填 | 默认值 | 说明 |
|---|---|---|---|
| `EVALUATION_IMPORT_CONCURRENCY` | 否 | `4` | 导入任务并发 |
| `EVALUATION_IMPORT_MAX_ZIP_BYTES` | 否 | `52428800` | ZIP 最大大小（50MB） |
| `EVALUATION_IMPORT_MAX_ZIP_ENTRIES` | 否 | `5000` | ZIP 最大条目数 |
| `EVALUATION_IMPORT_MAX_ZIP_UNCOMPRESSED_BYTES` | 否 | `209715200` | 解压后总大小上限（200MB） |
| `EVALUATION_IMPORT_MAX_ATTACHMENT_BYTES` | 否 | `20971520` | 单附件最大大小（20MB） |
| `EVALUATION_IMPORT_MAX_ERRORS` | 否 | `100` | 导入最大错误条数 |
| `EVALUATION_IMPORT_URL_TIMEOUT_MS` | 否 | `20000` | 下载超时 |
| `EVALUATION_IMPORT_URL_MAX_REDIRECTS` | 否 | `3` | 下载跳转上限 |
| `CHAT_ATTACHMENT_MAX_BYTES` | 否 | `20971520` | Chat 附件处理上限 |
| `FILES_BUFFER_DOWNLOAD_MAX_BYTES` | 否 | `52428800` | 文件缓冲下载上限 |
| `EVALUATION_ATTACHMENT_MAX_BYTES` | 否 | `20971520` | 评测附件处理上限 |

### 8) SMTP 邮件

| 变量 | 必填 | 默认值 | 说明 |
|---|---|---|---|
| `SMTP_HOST` | 视场景 | 无 | SMTP 地址 |
| `SMTP_PORT` | 否 | `587` | SMTP 端口 |
| `SMTP_SECURE` | 否 | `false` | 是否使用 SSL/TLS |
| `SMTP_USER` | 视场景 | 无 | SMTP 用户名 |
| `SMTP_PASS` | 视场景 | 无 | SMTP 密码 |
| `SMTP_FROM` | 视场景 | 无 | 发件人显示名与地址 |

说明：启用 `REQUIRE_EMAIL_VERIFICATION=true` 时，SMTP 相关变量是必需项。

### 9) OAuth 登录

| 变量 | 必填 | 默认值 | 说明 |
|---|---|---|---|
| `OAUTH_GOOGLE_ENABLED` | 否 | `false` | 是否启用 Google OAuth |
| `OAUTH_GOOGLE_CLIENT_ID` | 视场景 | 空 | Google 客户端 ID |
| `OAUTH_GOOGLE_CLIENT_SECRET` | 视场景 | 空 | Google 客户端 Secret |
| `OAUTH_GOOGLE_CALLBACK_URL` | 视场景 | 示例值 | Google 回调地址 |
| `OAUTH_LINUXDO_ENABLED` | 否 | `false` | 是否启用 Linux.do OAuth |
| `OAUTH_LINUXDO_CLIENT_ID` | 视场景 | 空 | Linux.do 客户端 ID |
| `OAUTH_LINUXDO_CLIENT_SECRET` | 视场景 | 空 | Linux.do 客户端 Secret |
| `OAUTH_LINUXDO_CALLBACK_URL` | 视场景 | 示例值 | Linux.do 回调地址 |

## 最小可运行配置

至少保证以下变量正确：

1. `DATABASE_URL`
2. `JWT_SECRET`
3. `ENCRYPTION_KEY`
4. `ADMIN_EMAIL`
5. `ADMIN_PASSWORD`
6. 若使用附件：`S3_*`
7. 若使用注册验证码：`SMTP_*`

## 生产建议

1. `NODE_ENV=production`
2. `EVALUATION_QUEUE_DRIVER=pg`
3. 独立部署 API 与 Worker
4. 根据数据库与模型配额调整并发：`EVALUATION_RUN_CONCURRENCY`、`EVALUATION_CASE_CONCURRENCY`
5. 按业务容量收紧导入与附件大小上限
