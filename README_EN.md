<div align="center">

# SSRPrompt

A production-ready AI Prompt development, evaluation, and publishing platform (v2.0).

[简体中文](./README.md) | [繁體中文](./README_ZH_TW.md) | English | [日本語](./README_JA.md) | [Website](https://www.ssrprompt.com)

[![License](https://img.shields.io/badge/license-GPL-blue.svg)](./LICENSE)

</div>

## Project Notes

- This repository is the **v2.0 architecture** (`packages/client` + `packages/server` + `packages/shared`).
- It is not deployment-compatible with the old `main` branch model.
- Backend uses PostgreSQL + Prisma, and API keys are never exposed to frontend.

## Current Capabilities (Code-Accurate)

### Prompt Lifecycle

- Prompt workspace: multi-turn messages, variables, structured output, parameter tuning, versioning.
- Prompt groups: grouping and ordering.
- Prompt plaza: browse/copy public prompts and versions.
- Prompt API: create API keys and invoke prompts via open endpoint.

### Evaluation & Analysis

- Evaluation center: datasets, test cases, criteria, runs.
- Run controls: execute, abort, batch result write.
- Import/export: template download, ZIP import, evaluation export.
- Analysis reports: save single-run/multi-run reports.

### Multimodal & Observability

- SSE chat streaming with reasoning/thinking display.
- File upload and attachments (requires S3-compatible storage).
- OCR providers: `paddle`, `paddle_vl`, `paddle_vl_1_5`, `datalab`, `mineru`.
- Traces: input/output, latency, tokens, attachments, OCR data.

### Security & Platform

- JWT + Refresh Token auth with demo token support.
- API keys encrypted with AES-256-GCM.
- Private share links (prompt/evaluation) with password verification and access logs.
- OAuth (Google / Linux.do), email verification, password reset.
- Admin user management (roles, status, account actions).

## Pages & Routes

| Page | Route |
|---|---|
| Home | `/` |
| Prompt Wizard | `/wizard` |
| Prompt Plaza | `/plaza` |
| Prompt Workspace | `/prompts` |
| Evaluation | `/evaluation` |
| Traces | `/traces` |
| Settings | `/settings` |
| Login / Forgot Password | `/login` / `/forgot-password` |
| Share Pages | `/share/p/:token` / `/share/e/:token` |

## Tech Stack

- Frontend: React 18 + TypeScript + Vite + Tailwind + Zustand + i18next
- Backend: Express + TypeScript + Prisma + PostgreSQL + Graphile Worker
- Shared: `@ssrprompt/shared` (types, schemas, error codes)

---

## Quick Start (Local Dev)

### 1) Requirements

- Node.js >= 18
- pnpm >= 8
- PostgreSQL >= 14

### 2) Install

```bash
git clone https://github.com/innocentshen/ssrprompt.git
cd ssrprompt
pnpm install
```

### 3) Configure env

```bash
cp packages/server/.env.example packages/server/.env
```

Minimum required (`packages/server/.env`):

```env
DATABASE_URL=postgresql://postgres:password@localhost:5432/ssrprompt?schema=public
JWT_SECRET=your-jwt-secret-at-least-32-characters-long
ENCRYPTION_KEY=your-64-character-hex-string-for-aes-256-encryption
```

Generate `ENCRYPTION_KEY`:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### 4) Init database

```bash
pnpm db:generate
pnpm db:deploy        # recommended: migration-based
# pnpm db:push         # optional for dev only
pnpm --filter @ssrprompt/server prisma:seed   # optional
```

### 5) Run

```bash
pnpm dev:all          # start client/server/worker together (recommended)

# or separately
pnpm dev              # frontend: http://localhost:5173
pnpm dev:server       # api:      http://localhost:3001
pnpm dev:worker       # worker
```

Swagger docs: `http://localhost:3001/api-docs`

---

## Production Target DB Schema Migration

Built-in script for any target database URL:

```bash
# regular: migrate deploy + status
pnpm db:deploy:target -- --database-url "postgresql://user:password@host:port/dbname"

# legacy DB with migration-history drift: resolve + deploy
pnpm db:deploy:target:resolve -- --database-url "postgresql://user:password@host:port/dbname"
```

If Prisma reports errors like `column ... does not exist`, run these first.

---

## Evaluation Queue & Worker Modes

`EVALUATION_QUEUE_DRIVER`:

- `memory` (default): in-process queue, good for dev/light usage.
- `pg`: Graphile Worker backed queue, recommended for production.

Production recommendation:

1. Set `EVALUATION_QUEUE_DRIVER=pg`
2. Initialize worker schema once:

```bash
pnpm --filter @ssrprompt/server worker:setup
```

3. Run API and worker separately:

```bash
pnpm --filter @ssrprompt/server start
pnpm --filter @ssrprompt/server start:worker
```

---

## Docker Deployment (Two Services)

Dockerfiles:

- `Dockerfile.ssrprompt-api`
- `Dockerfile.ssrprompt-worker`

Build:

```bash
docker build -f Dockerfile.ssrprompt-api -t <dockerhub_user>/ssrprompt-api:latest .
docker build -f Dockerfile.ssrprompt-worker -t <dockerhub_user>/ssrprompt-worker:latest .
```

Run:

```bash
# API
docker run -d --name ssrprompt-api -p 3001:3001 --env-file packages/server/.env <dockerhub_user>/ssrprompt-api:latest

# Worker
docker run -d --name ssrprompt-worker --env-file packages/server/.env <dockerhub_user>/ssrprompt-worker:latest
```

For Zeabur/GitHub source builds, use different startup commands:

- API: `node packages/server/dist/index.js`
- Worker: `node packages/server/dist/worker.js`

---

## Key Backend Env Vars

### Required

- `NODE_ENV`
- `PORT` (default `3001`)
- `DATABASE_URL`
- `JWT_SECRET`
- `ENCRYPTION_KEY`
- `CORS_ORIGIN`

### Common Optional

- Registration/auth: `ALLOW_REGISTRATION`, `REQUIRE_EMAIL_VERIFICATION`
- SMTP: `SMTP_HOST` `SMTP_PORT` `SMTP_USER` `SMTP_PASS` `SMTP_FROM`
- OAuth: `OAUTH_GOOGLE_*`, `OAUTH_LINUXDO_*`
- S3: `S3_ENDPOINT` `S3_BUCKET` `S3_ACCESS_KEY_ID` `S3_SECRET_ACCESS_KEY` `S3_REGION`
- Rate limit: `RATE_LIMIT_WINDOW_MS`, `RATE_LIMIT_MAX_REQUESTS`
- Evaluation queue: `EVALUATION_QUEUE_DRIVER` and `EVALUATION_*` tuning vars

See full template: `packages/server/.env.example`

---

## API Overview (v1)

Base prefix: `/api/v1`

- Auth: `/auth/*`
- Health: `/health`
- Prompt: `/prompts`, `/prompt-groups`
- Model: `/providers`, `/models`
- Chat: `/chat/completions`
- Evaluation: `/evaluations`, `/runs`, `/test-cases`, `/criteria`
- Import/export: `/evaluation-imports`
- File/OCR: `/files`, `/ocr`
- Share: `/share-links`, `/share`
- Prompt API: `/prompt-api-keys`, `/open/prompts/:promptId/invoke`
- Traces/stats: `/traces`, `/stats/usage`
- Admin: `/users`

Use Swagger as source of truth: `/api-docs`

---

## Common Commands

```bash
# dev
pnpm dev
pnpm dev:server
pnpm dev:worker
pnpm dev:all

# build
pnpm build
pnpm build:server
pnpm build:all

# database
pnpm db:generate
pnpm db:migrate
pnpm db:deploy
pnpm db:deploy:target
pnpm db:deploy:target:resolve
pnpm db:studio

# quality
pnpm lint
pnpm typecheck
```

---

## License

GPL

## Contributing

Issues and PRs are welcome.

## Related Docs

- [README.md](./README.md)
- [README_ZH_TW.md](./README_ZH_TW.md)
- [README_JA.md](./README_JA.md)
- [CLAUDE.md](./CLAUDE.md)
