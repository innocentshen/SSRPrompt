<div align="center">

# SSRPrompt

本番運用を前提とした AI Prompt 開発・評価・公開プラットフォーム（v2.0）。

[简体中文](./README.md) | [繁體中文](./README_ZH_TW.md) | [English](./README_EN.md) | 日本語 | [公式サイト](https://www.ssrprompt.com)

[![License](https://img.shields.io/badge/license-GPL-blue.svg)](./LICENSE)

</div>

## プロジェクト概要

- このリポジトリは **v2.0 構成**（`packages/client` + `packages/server` + `packages/shared`）です。
- 旧 `main` ブランチのデプロイ方式とは互換性がありません。
- バックエンドは PostgreSQL + Prisma を使用し、API Key はフロントに露出しません。

## 現在の機能（コード準拠）

### Prompt ライフサイクル

- Prompt ワークスペース：マルチターン、変数、構造化出力、パラメータ調整、バージョン管理。
- Prompt グループ：グループ化と並び替え。
- Prompt Plaza：公開 Prompt の閲覧/コピー、バージョン確認。
- Prompt API：API Key を作成し、公開エンドポイントで Prompt を呼び出し可能。

### 評価と分析

- 評価センター：評価セット、テストケース、評価基準、実行履歴。
- 実行制御：実行、中断、結果のバッチ書き込み。
- インポート/エクスポート：テンプレート取得、ZIP インポート、評価エクスポート。
- 分析レポート：単体/複数実行レポートの保存。

### マルチモーダルと可観測性

- Chat SSE ストリーミング、reasoning/thinking 表示に対応。
- ファイルアップロードと添付（S3 互換ストレージが必要）。
- OCR プロバイダ：`paddle`、`paddle_vl`、`paddle_vl_1_5`、`datalab`、`mineru`。
- Trace：入出力、レイテンシ、Token、添付、OCR 情報を追跡。

### セキュリティとプラットフォーム

- JWT + Refresh Token 認証、Demo Token 対応。
- API Key は AES-256-GCM で暗号化保存。
- プライベート共有リンク（Prompt / Evaluation）+ パスワード検証 + アクセスログ。
- OAuth（Google / Linux.do）、メール認証コード、パスワードリセット。
- 管理者ユーザー管理（ロール、状態、アカウント操作）。

## ページとルート

| ページ | ルート |
|---|---|
| ホーム | `/` |
| Prompt Wizard | `/wizard` |
| Prompt Plaza | `/plaza` |
| Prompt Workspace | `/prompts` |
| Evaluation | `/evaluation` |
| Traces | `/traces` |
| Settings | `/settings` |
| ログイン / パスワード再設定 | `/login` / `/forgot-password` |
| 共有ページ | `/share/p/:token` / `/share/e/:token` |

## 技術スタック

- フロントエンド：React 18 + TypeScript + Vite + Tailwind + Zustand + i18next
- バックエンド：Express + TypeScript + Prisma + PostgreSQL + Graphile Worker
- 共通：`@ssrprompt/shared`（型、Schema、エラーコード）

---

## クイックスタート（ローカル開発）

### 1) 要件

- Node.js >= 18
- pnpm >= 8
- PostgreSQL >= 14

### 2) インストール

```bash
git clone https://github.com/innocentshen/ssrprompt.git
cd ssrprompt
pnpm install
```

### 3) 環境変数設定

```bash
cp packages/server/.env.example packages/server/.env
```

最低限必要（`packages/server/.env`）：

```env
DATABASE_URL=postgresql://postgres:password@localhost:5432/ssrprompt?schema=public
JWT_SECRET=your-jwt-secret-at-least-32-characters-long
ENCRYPTION_KEY=your-64-character-hex-string-for-aes-256-encryption
```

`ENCRYPTION_KEY` の生成：

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### 4) DB 初期化

```bash
pnpm db:generate
pnpm db:deploy        # 推奨: migration ベース
# pnpm db:push         # 開発時のみ任意
pnpm --filter @ssrprompt/server prisma:seed   # 任意
```

### 5) 起動

```bash
pnpm dev:all          # client/server/worker を同時起動（推奨）

# または個別起動
pnpm dev              # frontend: http://localhost:5173
pnpm dev:server       # api:      http://localhost:3001
pnpm dev:worker       # worker
```

Swagger: `http://localhost:3001/api-docs`

---

## 本番ターゲットDBスキーマ更新

任意の `DATABASE_URL` に対して実行可能な組み込みスクリプト：

```bash
# 通常: migrate deploy + status
pnpm db:deploy:target -- --database-url "postgresql://user:password@host:port/dbname"

# 旧DBで migration 履歴ドリフトがある場合: resolve + deploy
pnpm db:deploy:target:resolve -- --database-url "postgresql://user:password@host:port/dbname"
```

Prisma の `column ... does not exist` などが出る場合は先に実行してください。

---

## 評価キューと Worker モード

`EVALUATION_QUEUE_DRIVER` のモード：

- `memory`（デフォルト）：プロセス内キュー、開発/軽量用途向け。
- `pg`：Graphile Worker キュー、本番推奨。

本番推奨手順：

1. `EVALUATION_QUEUE_DRIVER=pg` を設定
2. 初回のみ worker schema を初期化

```bash
pnpm --filter @ssrprompt/server worker:setup
```

3. API と Worker を分離起動

```bash
pnpm --filter @ssrprompt/server start
pnpm --filter @ssrprompt/server start:worker
```

---

## Docker デプロイ（2サービス）

Dockerfile：

- `Dockerfile.ssrprompt-api`
- `Dockerfile.ssrprompt-worker`

ビルド：

```bash
docker build -f Dockerfile.ssrprompt-api -t <dockerhub_user>/ssrprompt-api:latest .
docker build -f Dockerfile.ssrprompt-worker -t <dockerhub_user>/ssrprompt-worker:latest .
```

実行：

```bash
# API
docker run -d --name ssrprompt-api -p 3001:3001 --env-file packages/server/.env <dockerhub_user>/ssrprompt-api:latest

# Worker
docker run -d --name ssrprompt-worker --env-file packages/server/.env <dockerhub_user>/ssrprompt-worker:latest
```

Zeabur/GitHub ソースビルド時は起動コマンドを分けて設定：

- API：`node packages/server/dist/index.js`
- Worker：`node packages/server/dist/worker.js`

---

## バックエンド主要環境変数

### 必須

- `NODE_ENV`
- `PORT`（デフォルト `3001`）
- `DATABASE_URL`
- `JWT_SECRET`
- `ENCRYPTION_KEY`
- `CORS_ORIGIN`

### よく使う任意設定

- 登録/認証：`ALLOW_REGISTRATION`、`REQUIRE_EMAIL_VERIFICATION`
- SMTP：`SMTP_HOST` `SMTP_PORT` `SMTP_USER` `SMTP_PASS` `SMTP_FROM`
- OAuth：`OAUTH_GOOGLE_*`、`OAUTH_LINUXDO_*`
- S3：`S3_ENDPOINT` `S3_BUCKET` `S3_ACCESS_KEY_ID` `S3_SECRET_ACCESS_KEY` `S3_REGION`
- レート制限：`RATE_LIMIT_WINDOW_MS`、`RATE_LIMIT_MAX_REQUESTS`
- 評価キュー：`EVALUATION_QUEUE_DRIVER` と `EVALUATION_*` 調整変数

完全なテンプレート：`packages/server/.env.example`

---

## API 概要（v1）

プレフィックス：`/api/v1`

- 認証：`/auth/*`
- ヘルスチェック：`/health`
- Prompt：`/prompts`、`/prompt-groups`
- モデル：`/providers`、`/models`
- チャット：`/chat/completions`
- 評価：`/evaluations`、`/runs`、`/test-cases`、`/criteria`
- インポート/エクスポート：`/evaluation-imports`
- ファイル/OCR：`/files`、`/ocr`
- 共有：`/share-links`、`/share`
- Prompt API：`/prompt-api-keys`、`/open/prompts/:promptId/invoke`
- トレース/統計：`/traces`、`/stats/usage`
- 管理者：`/users`

正確な仕様は Swagger を参照：`/api-docs`

---

## よく使うコマンド

```bash
# 開発
pnpm dev
pnpm dev:server
pnpm dev:worker
pnpm dev:all

# ビルド
pnpm build
pnpm build:server
pnpm build:all

# データベース
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

## ライセンス

GPL

## コントリビュート

Issue / PR を歓迎します。

## 関連ドキュメント

- [README.md](./README.md)
- [README_EN.md](./README_EN.md)
- [README_ZH_TW.md](./README_ZH_TW.md)
- [CLAUDE.md](./CLAUDE.md)
