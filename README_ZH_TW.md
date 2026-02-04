<div align="center">

# SSRPrompt

一個現代化的 AI Prompt 開發與評測平台，幫助開發者更高效地開發、測試與管理 AI Prompts。

[简体中文](./README.md) | 繁體中文 | [English](./README_EN.md) | [日本語](./README_JA.md) | [官網](https://www.ssrprompt.com)

[![License](https://img.shields.io/badge/license-GPL-blue.svg)](./LICENSE)

</div>

## v2.0 架構升級

SSRPrompt v2.0 採用全新的前後端分離架構，帶來更好的安全性、可維護性與擴展性：

- **Monorepo 架構** - 使用 pnpm workspace 管理多包專案
- **API Key 加密儲存** - AES-256-GCM 加密保護敏感資訊
- **後端 AI 代理** - 所有 AI 呼叫皆透過後端代理，前端不接觸 API Key
- **SSE 串流回應** - 支援即時串流輸出，優化使用體驗
- **多租戶隔離** - 強制使用者資料隔離，保障資料安全
- **PostgreSQL** - 統一使用 PostgreSQL 資料庫

## 與 main 分支差異

> 目前分支為 v2.0 重構版本；與 `main` 分支（穩定版）的架構/部署方式不相容。

| 維度 | `main`（穩定版） | 目前分支（v2.0） |
|---|---|---|
| 包管理 | npm | pnpm workspace |
| 程式碼結構 | 單倉前端 + 可選 `server/`（MySQL 代理） | Monorepo：`packages/client` + `packages/server` + `packages/shared` |
| 資料庫 | Supabase（PostgreSQL）/ MySQL；支援 Demo 免配置體驗 | 僅 PostgreSQL；Prisma 管理 Schema；提供舊版資料遷移腳本 |
| AI 呼叫與 Key | 主要由前端發起呼叫 | 統一由後端代理；API Key AES-256-GCM 加密儲存；前端不接觸 Key |
| 認證與會話 | 前端訪問密碼（`VITE_APP_PASSWORD`） | JWT 登入 + Refresh Token；Access Token 24h；Demo 有效期 7 天 |
| 配置方式 | 以設定頁為主 | 以服務端 `.env` 為主（`DATABASE_URL/JWT_SECRET/ENCRYPTION_KEY` 等） |
| 啟動方式 | 可僅啟動前端（Supabase/Demo） | 需要啟動後端（建議 `pnpm dev:all` 同時啟動 client/server/worker） |

## 功能特性

### 核心功能

- **Prompt 開發** - 可視化介面開發與管理 AI Prompts，支援變數、多輪對話、結構化輸出
- **Prompt 列表快捷操作** - 支援一鍵複製 Prompt、刪除（再次確認）
- **Prompt 建立嚮導** - AI 驅動的對話式 Prompt 建立流程，支援模板快速開始
- **評測中心** - 對 Prompts 進行系統化評測與對比，支援自定義評價標準與 AI 評分
- **歷史記錄** - 追蹤與查看 Prompt 執行歷史，包含 Token 消耗與延遲統計
- **智慧優化** - AI 驅動的 Prompt 分析與優化建議

### 高級特性

- **多模型支援** - 支援 OpenAI、Anthropic、Google Gemini、OpenRouter 等多種 AI 服務商
- **推理模型支援** - 支援 Claude、DeepSeek R1 等推理模型的 Thinking 輸出展示
- **附件支援** - 支援圖片、PDF、文字等作為上下文（自動 vision/OCR）
- **版本管理** - Prompt 版本歷史與對比功能
- **即時串流輸出** - SSE 串流回應，支援中斷與重試

### 平台特性

- **Demo 模式** - 無需配置即可快速體驗系統（7 天有效期）
- **多語言支援** - 支援簡體中文、繁體中文、英文、日文
- **主題切換** - 支援明暗主題切換
- **JWT 認證** - 安全的使用者認證機制

## 亮點

- **安全預設**：API Key 僅存於後端並使用 AES-256-GCM 加密；前端永遠不直接接觸 Key。
- **可觀測**：從 Prompt 運行到評測，都能在 Trace 中看到輸入/輸出、Thinking、耗時/Token、附件與 OCR 結果，方便定位問題。
- **多模態**：支援圖片/PDF/文字附件；可按模型能力自動選擇 vision 或 OCR 流程。
- **可評測**：以測試用例 + 評價標準（支援 AI 打分）對 Prompt 做系統化對比，並可匯出結果用於復盤/報告。

## 頁面與功能分布

| 頁面 | 路由 | 主要功能 |
|---|---|---|
| 首頁 | `/` | 快速入口：Prompt 嚮導 / 工作區 / 廣場 |
| Prompt 嚮導 | `/wizard` | 選擇模板 → 對話生成 Prompt → 一鍵儲存到工作區 |
| Prompt 工作區 | `/prompts` | Prompt/分組管理、變數、結構化輸出、參數面板、測試運行、版本歷史/對比、發布到廣場、觀察/優化 |
| Prompt 廣場 | `/plaza` | 瀏覽公開 Prompt、查看版本、複製到我的工作區並二次編輯 |
| 評測中心 | `/evaluation` | 建立評測、管理測試用例/評價標準、運行評測、結果對比、匯出 CSV |
| 呼叫追蹤 | `/traces` | Trace 列表/篩選、查看輸入輸出、Thinking、參數、耗時/Token、附件與 OCR 結果 |
| 設定 | `/settings` | 服務商/模型配置、優化設定、OCR 設定、使用者管理（管理員） |
| 登入/找回密碼 | `/login` `/forgot-password` | 信箱密碼登入、第三方登入、Demo 模式 |

## 使用指南（從 0 到 1）

1. 登入：信箱/密碼或第三方登入（Google/Linux.do），也可以先進入 Demo 模式快速體驗。
2. 先配置模型：進入「設定 → Providers」，新增服務商並填入 API Key；再新增/啟用模型（沒有可用模型將無法運行 Prompt）。
3. 建立 Prompt：
   - 新手：從「Prompt 嚮導」選擇模板，和 AI 對話生成 Prompt，再儲存到工作區。
   - 進階：在「Prompt 工作區」直接建立/編輯多輪訊息、變數與結構化輸出。
4. 調試 Prompt：在工作區使用測試面板選擇模型、填寫變數、調整參數；支援串流輸出、Thinking 展示、附件（圖片/PDF/文字）與 OCR。
5. 評測對比：在「評測中心」新增測試用例與評價標準（可用 AI 打分），批量運行並對比結果，支援匯出 CSV。
6. 分享復用：將你的 Prompt 發佈到「廣場」，或從廣場一鍵複製他人 Prompt 到自己的工作區繼續迭代。

## 前置依賴（必需 / 可選）

必需：

- PostgreSQL（服務端資料儲存）

可選（按需啟用）：

- S3 相容物件儲存（附件上傳、檔案預覽、OCR 結果/中間檔案儲存）
- SMTP（開啟信箱驗證碼註冊 / 找回密碼）
- OAuth（Google / Linux.do 第三方登入）
- 評測 Worker（生產建議設定 `EVALUATION_QUEUE_DRIVER=pg` 並運行 worker 行程；開發環境使用 `pnpm dev:all` 或 `pnpm dev:worker`）

## 快速開始（開發）

### 環境要求

- Node.js >= 18
- pnpm >= 8
- PostgreSQL >= 14

### 安裝

```bash
git clone https://github.com/innocentshen/ssrprompt.git
cd ssrprompt
pnpm install
```

### 配置

```bash
cp packages/server/.env.example packages/server/.env
# 設定 DATABASE_URL, JWT_SECRET, ENCRYPTION_KEY
```

### 初始化資料庫

```bash
pnpm db:generate
pnpm db:push
pnpm db:studio
pnpm --filter @ssrprompt/server prisma:seed
```

### 啟動

```bash
pnpm dev:all        # client + server + worker

# 或分別啟動
pnpm dev
pnpm dev:server
pnpm dev:worker
```

## OAuth（第三方登入）

在後端設定以下環境變數，並在對應平台的 OAuth 應用後台把「回呼地址」設定為同樣的 URL：

```env
OAUTH_GOOGLE_ENABLED=true
OAUTH_GOOGLE_CLIENT_ID=...
OAUTH_GOOGLE_CLIENT_SECRET=...
OAUTH_GOOGLE_CALLBACK_URL=https://api.your-domain.com/api/v1/auth/oauth/google/callback

OAUTH_LINUXDO_ENABLED=true
OAUTH_LINUXDO_CLIENT_ID=...
OAUTH_LINUXDO_CLIENT_SECRET=...
OAUTH_LINUXDO_CALLBACK_URL=https://api.your-domain.com/api/v1/auth/oauth/linuxdo/callback
```

注意：

- `CORS_ORIGIN` 需要包含前端網域（例如 `https://www.your-domain.com`），否則 `/auth/oauth/*?redirect=...` 會拒絕該重定向參數。
- 若前後端分離部署（例如前端在 Vercel、後端在 Zeabur），**OAuth 回呼 URL 必須指向後端網域**（也就是運行 Express 的網域）。把回呼設定到前端網域（尤其啟用了 SPA rewrite）會被前端路由接管，表現為「登入後跳回首頁但未登入」。
- 為兼容「回呼誤設到前端網域」的情況，前端內建 `/api/v1/auth/oauth/:provider/callback` 的兜底轉發（僅 `google` / `linuxdo`），會把回呼參數原樣轉發到 `${VITE_API_URL}/auth/oauth/:provider/callback`。

## API 文件

Swagger：`http://localhost:3001/api-docs`
