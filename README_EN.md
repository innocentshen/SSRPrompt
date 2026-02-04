<div align="center">

# SSRPrompt

A modern AI prompt development and evaluation platform that helps developers build, test, compare, and manage prompts efficiently.

[简体中文](./README.md) | [繁體中文](./README_ZH_TW.md) | English | [日本語](./README_JA.md) | [Website](https://www.ssrprompt.com)

[![License](https://img.shields.io/badge/license-GPL-blue.svg)](./LICENSE)

</div>

## v2.0 Architecture

SSRPrompt v2.0 adopts a new frontend/backend separated architecture with better security, maintainability and scalability:

- **Monorepo** - pnpm workspace with multi-package structure
- **Encrypted API keys** - AES-256-GCM encryption for sensitive secrets
- **Backend AI proxy** - all model calls go through backend; frontend never touches API keys
- **SSE streaming** - realtime streaming output, supports abort/retry
- **Tenant isolation** - strict per-user data isolation
- **PostgreSQL** - unified primary database

## Differences from `main`

> This branch is the v2.0 refactor. It is not compatible with the deployment model of the `main` branch (stable).

| Dimension | `main` (stable) | This branch (v2.0) |
|---|---|---|
| Package manager | npm | pnpm workspace |
| Code layout | Single frontend + optional `server/` (MySQL proxy) | Monorepo: `packages/client` + `packages/server` + `packages/shared` |
| Database | Supabase (PostgreSQL) / MySQL; demo without backend setup | PostgreSQL only; Prisma schema; includes migration scripts |
| Model calls & keys | Mostly from frontend | Backend proxy; keys encrypted; frontend has no keys |
| Auth & sessions | Frontend password (`VITE_APP_PASSWORD`) | JWT + Refresh Token; demo expires in 7 days |
| Config | Mainly via UI | Mainly via backend `.env` (`DATABASE_URL/JWT_SECRET/ENCRYPTION_KEY` …) |
| Startup | Frontend-only possible (Supabase/Demo) | Backend required (recommended: `pnpm dev:all` to start client/server/worker) |

## Features

### Core

- **Prompt workspace** - build and manage prompts with variables, multi-turn messages, and structured outputs
- **Fast operations** - one-click copy, safe delete (confirm)
- **Prompt wizard** - template-based, chat-driven prompt creation
- **Evaluation center** - systematic evaluation and comparison with custom criteria and AI scoring
- **History & traces** - execution history, tokens, latency, attachments, OCR insights
- **Optimization** - AI-assisted prompt analysis and improvement suggestions

### Advanced

- **Multi-provider** - OpenAI / Anthropic / Google Gemini / OpenRouter / custom endpoints
- **Reasoning models** - renders “thinking” output when available (e.g. Claude / DeepSeek R1)
- **Attachments** - image/PDF/text as context; auto vision/OCR routing
- **Versioning** - prompt version history and diff
- **Streaming** - SSE streaming output with abort/retry

### Platform

- **Demo mode** - quick try-out (7 days)
- **i18n** - zh-CN / zh-TW / en / ja
- **Theme** - light/dark
- **JWT auth** - secure authentication model

## Highlights

- **Secure by default**: API keys are stored only on the backend and encrypted with AES-256-GCM; the frontend never touches keys directly.
- **Observable**: from prompt runs to evaluations, you can inspect input/output, thinking, latency/tokens, attachments and OCR results via traces.
- **Multimodal**: supports image/PDF/text attachments; can route automatically to vision or OCR based on model capability.
- **Evaluatable**: evaluate prompts with test cases + criteria (AI scoring supported), compare runs and export results (CSV).

## Pages & Feature Map

| Page | Route | What you can do |
|---|---|---|
| Home | `/` | Quick entry to Wizard / Workspace / Plaza |
| Prompt Wizard | `/wizard` | Pick template → chat to generate → save to workspace |
| Prompt Workspace | `/prompts` | Manage prompts & groups, variables, schemas, parameters, test runs, versioning/diff, publish, observe/optimize |
| Prompt Plaza | `/plaza` | Browse public prompts, view versions, copy into your workspace |
| Evaluation | `/evaluation` | Create evals, manage test cases & criteria, run, compare, export CSV |
| Traces | `/traces` | List/filter traces, inspect I/O, thinking, params, latency/tokens, attachments & OCR |
| Settings | `/settings` | Providers/models, optimization, OCR settings, user management (admin) |
| Auth | `/login` `/forgot-password` | Email/password, social login, demo mode |

## How to Use (0 → 1)

1. Sign in: email/password or social login (Google/Linux.do). You can also enter Demo mode first.
2. Configure models: go to `Settings → Providers`, add a provider and API key, then add/enable models.
3. Create prompts:
   - Beginner: use the Prompt Wizard and save the result into workspace.
   - Advanced: edit multi-turn messages, variables and output schemas directly in the workspace.
4. Test & debug: in workspace, choose model, fill variables, tune params; supports streaming output, thinking, attachments and OCR.
5. Evaluate & compare: in Evaluation center, add test cases and criteria (AI scoring supported), run at scale and export CSV.
6. Share & reuse: publish to Plaza or copy public prompts into your workspace to iterate further.

## Prerequisites (Required / Optional)

Required:

- PostgreSQL (backend storage)

Optional (enable when needed):

- S3-compatible object storage (attachments upload/preview, OCR artifacts/results)
- SMTP (email verification + password reset)
- OAuth providers (Google / Linux.do)
- Evaluation worker (recommended in production: set `EVALUATION_QUEUE_DRIVER=pg` and run the worker process; in dev use `pnpm dev:all` or `pnpm dev:worker`)

## Tech Stack

Frontend (`packages/client`):

- React 18 + TypeScript, Vite 5, Tailwind CSS, Zustand, i18next

Backend (`packages/server`):

- Express + TypeScript, Prisma, PostgreSQL, JWT, AES-256-GCM

Shared (`packages/shared`):

- TypeScript types, Zod schemas, shared error codes

## Quick Start (Dev)

### Requirements

- Node.js >= 18
- pnpm >= 8
- PostgreSQL >= 14

### Install

```bash
git clone https://github.com/innocentshen/ssrprompt.git
cd ssrprompt
pnpm install
```

### Configure

```bash
cp packages/server/.env.example packages/server/.env
# edit DATABASE_URL, JWT_SECRET, ENCRYPTION_KEY
```

### Init DB

```bash
pnpm db:generate
pnpm db:push
pnpm db:studio
pnpm --filter @ssrprompt/server prisma:seed
```

### Run

```bash
pnpm dev:all        # client + server + worker

# or separately
pnpm dev            # client  http://localhost:5173
pnpm dev:server     # server  http://localhost:3001
pnpm dev:worker     # worker
```

## Deployment

### Architecture

- **Frontend (Web)**: static assets (`pnpm build` → `packages/client/dist`), deploy to Nginx / Vercel / object storage
- **Backend (API)**: Node.js + Express (`:3001` by default)
- **Database**: PostgreSQL (required)
- **Object storage**: S3 compatible (optional; required for attachments)

### Environment Variables

Backend (`packages/server`):

```env
NODE_ENV=production
DATABASE_URL=postgresql://...
JWT_SECRET=<at least 32 chars>
ENCRYPTION_KEY=<64 hex chars>
CORS_ORIGIN=https://your-frontend-domain.com
```

Frontend build-time (`packages/client`):

```env
VITE_API_URL=https://api.your-domain.com/api/v1
```

#### OAuth (Social Login)

Configure in backend and set the same callback URLs in the OAuth app console:

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

Notes:

- `CORS_ORIGIN` must include your frontend origin, otherwise `/auth/oauth/*?redirect=...` will reject the redirect parameter.
- If frontend and backend are deployed separately (e.g. Vercel + Zeabur), **OAuth callback URLs must point to the backend domain** (the Express server). If you configure the callback to the frontend domain (especially with SPA rewrites), the frontend router may take over and you will see “redirected to home but not logged in”.
- To mitigate misconfigured callbacks, the frontend includes a fallback proxy route `/api/v1/auth/oauth/:provider/callback` (only `google` / `linuxdo`) that forwards query params to `${VITE_API_URL}/auth/oauth/:provider/callback`.

## API Docs

Swagger (recommended): `http://localhost:3001/api-docs`
