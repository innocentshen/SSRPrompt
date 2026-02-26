<div align="center">

# SSRPrompt

一個面向生產環境的 AI Prompt 開發、評測與發布平台（v2.0）。

[简体中文](./README.md) | 繁體中文 | [English](./README_EN.md) | [日本語](./README_JA.md) | [官網](https://www.ssrprompt.com)

[![License](https://img.shields.io/badge/license-GPL-blue.svg)](./LICENSE)

</div>

## 專案說明

- 此倉庫為 **v2.0 重構架構**（`packages/client` + `packages/server` + `packages/shared`）。
- 與 `main` 分支（舊部署模式）不相容。
- 後端統一使用 PostgreSQL + Prisma，前端不直接接觸模型 API Key。

## 目前版本能力（依程式碼現況）

### Prompt 全流程

- Prompt 工作區：多輪訊息、變數、結構化輸出、參數調整、版本管理。
- Prompt 分組：支援分組與排序。
- Prompt 廣場：瀏覽/複製公開 Prompt 與版本。
- Prompt API：可建立 API Key 並透過開放介面呼叫指定 Prompt。

### 評測與分析

- 評測中心：評測集、測試案例、評分標準、執行紀錄。
- 執行控制：執行、中止、批次寫入結果。
- 匯入匯出：模板下載、ZIP 匯入、評測匯出。
- 分析報告：支援單次/多次執行分析報告保存。

### 多模態與可觀測

- Chat SSE 串流輸出，支援 reasoning/thinking 顯示。
- 檔案上傳與附件（需 S3 相容物件儲存）。
- OCR 供應商：`paddle`、`paddle_vl`、`paddle_vl_1_5`、`datalab`、`mineru`。
- Trace 追蹤：輸入輸出、延遲、Token、附件、OCR 資訊。

### 安全與平台

- JWT + Refresh Token 驗證，支援 Demo Token。
- API Key 以 AES-256-GCM 加密儲存。
- 私有分享連結（Prompt / Evaluation）+ 密碼驗證 + 存取日誌。
- OAuth（Google / Linux.do）、信箱驗證碼、忘記密碼。
- 管理員使用者管理（角色、狀態、帳號操作）。

## 頁面與路由

| 頁面 | 路由 |
|---|---|
| 首頁 | `/` |
| Prompt 嚮導 | `/wizard` |
| Prompt 廣場 | `/plaza` |
| Prompt 工作區 | `/prompts` |
| 評測中心 | `/evaluation` |
| 呼叫追蹤 | `/traces` |
| 設定 | `/settings` |
| 登入 / 忘記密碼 | `/login` / `/forgot-password` |
| 分享頁 | `/share/p/:token` / `/share/e/:token` |

## 技術棧

- 前端：React 18 + TypeScript + Vite + Tailwind + Zustand + i18next
- 後端：Express + TypeScript + Prisma + PostgreSQL + Graphile Worker
- 共享：`@ssrprompt/shared`（型別、Schema、錯誤碼）

---

## 快速開始（本機開發）

### 1) 環境需求

- Node.js >= 18
- pnpm >= 8
- PostgreSQL >= 14

### 2) 安裝

```bash
git clone https://github.com/innocentshen/ssrprompt.git
cd ssrprompt
pnpm install
```

### 3) 設定環境變數

```bash
cp packages/server/.env.example packages/server/.env
```

最低必填（`packages/server/.env`）：

```env
DATABASE_URL=postgresql://postgres:password@localhost:5432/ssrprompt?schema=public
JWT_SECRET=your-jwt-secret-at-least-32-characters-long
ENCRYPTION_KEY=your-64-character-hex-string-for-aes-256-encryption
```

產生 `ENCRYPTION_KEY`：

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### 4) 初始化資料庫

```bash
pnpm db:generate
pnpm db:deploy        # 建議：以 migration 為準
# pnpm db:push         # 僅開發場景可選
pnpm --filter @ssrprompt/server prisma:seed   # 可選
```

### 5) 啟動

```bash
pnpm dev:all          # 同時啟動 client/server/worker（建議）

# 或分開啟動
pnpm dev              # 前端: http://localhost:5173
pnpm dev:server       # API:  http://localhost:3001
pnpm dev:worker       # Worker
```

Swagger 文件：`http://localhost:3001/api-docs`

---

## 線上目標資料庫結構升級

倉庫已內建目標庫遷移腳本（可傳任意 `DATABASE_URL`）：

```bash
# 一般：對目標庫執行 migrate deploy + status
pnpm db:deploy:target -- --database-url "postgresql://user:password@host:port/dbname"

# 歷史庫有 migration 紀錄漂移：先 resolve 再 deploy
pnpm db:deploy:target:resolve -- --database-url "postgresql://user:password@host:port/dbname"
```

若出現 Prisma 類似 `column ... does not exist`，先執行上述命令。

---

## 評測佇列與 Worker 模式

`EVALUATION_QUEUE_DRIVER` 支援：

- `memory`（預設）：進程內佇列，適合開發/輕量場景。
- `pg`：Graphile Worker 佇列，建議生產使用。

生產建議：

1. 設定 `EVALUATION_QUEUE_DRIVER=pg`
2. 首次初始化 worker schema：

```bash
pnpm --filter @ssrprompt/server worker:setup
```

3. 分開跑 API 與 Worker：

```bash
pnpm --filter @ssrprompt/server start
pnpm --filter @ssrprompt/server start:worker
```

---

## Docker 部署（雙服務）

Dockerfile：

- `Dockerfile.ssrprompt-api`
- `Dockerfile.ssrprompt-worker`

建置：

```bash
docker build -f Dockerfile.ssrprompt-api -t <dockerhub_user>/ssrprompt-api:latest .
docker build -f Dockerfile.ssrprompt-worker -t <dockerhub_user>/ssrprompt-worker:latest .
```

執行：

```bash
# API
docker run -d --name ssrprompt-api -p 3001:3001 --env-file packages/server/.env <dockerhub_user>/ssrprompt-api:latest

# Worker
docker run -d --name ssrprompt-worker --env-file packages/server/.env <dockerhub_user>/ssrprompt-worker:latest
```

若在 Zeabur/GitHub 來源建置，API 與 Worker 啟動命令需分開：

- API：`node packages/server/dist/index.js`
- Worker：`node packages/server/dist/worker.js`

---

## 後端關鍵環境變數

### 必填

- `NODE_ENV`
- `PORT`（預設 `3001`）
- `DATABASE_URL`
- `JWT_SECRET`
- `ENCRYPTION_KEY`
- `CORS_ORIGIN`

### 常用選填

- 註冊與驗證：`ALLOW_REGISTRATION`、`REQUIRE_EMAIL_VERIFICATION`
- SMTP：`SMTP_HOST` `SMTP_PORT` `SMTP_USER` `SMTP_PASS` `SMTP_FROM`
- OAuth：`OAUTH_GOOGLE_*`、`OAUTH_LINUXDO_*`
- S3：`S3_ENDPOINT` `S3_BUCKET` `S3_ACCESS_KEY_ID` `S3_SECRET_ACCESS_KEY` `S3_REGION`
- 限流：`RATE_LIMIT_WINDOW_MS`、`RATE_LIMIT_MAX_REQUESTS`
- 評測佇列：`EVALUATION_QUEUE_DRIVER` 與 `EVALUATION_*` 調參

完整模板：`packages/server/.env.example`

---

## API 概覽（v1）

前綴：`/api/v1`

- 認證：`/auth/*`
- 健康檢查：`/health`
- Prompt：`/prompts`、`/prompt-groups`
- 模型：`/providers`、`/models`
- 對話：`/chat/completions`
- 評測：`/evaluations`、`/runs`、`/test-cases`、`/criteria`
- 匯入匯出：`/evaluation-imports`
- 檔案/OCR：`/files`、`/ocr`
- 分享：`/share-links`、`/share`
- Prompt API：`/prompt-api-keys`、`/open/prompts/:promptId/invoke`
- 追蹤與統計：`/traces`、`/stats/usage`
- 管理員：`/users`

以 Swagger 為準：`/api-docs`

---

## 常用命令

```bash
# 開發
pnpm dev
pnpm dev:server
pnpm dev:worker
pnpm dev:all

# 建置
pnpm build
pnpm build:server
pnpm build:all

# 資料庫
pnpm db:generate
pnpm db:migrate
pnpm db:deploy
pnpm db:deploy:target
pnpm db:deploy:target:resolve
pnpm db:studio

# 品質
pnpm lint
pnpm typecheck
```

---

## 授權

GPL

## 貢獻

歡迎提交 Issue / PR。

## 相關文件

- [README.md](./README.md)
- [README_EN.md](./README_EN.md)
- [README_JA.md](./README_JA.md)
- [CLAUDE.md](./CLAUDE.md)
