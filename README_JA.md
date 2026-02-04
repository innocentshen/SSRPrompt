<div align="center">

# SSRPrompt

AI Prompt の開発・テスト・比較・管理を効率化する、モダンなプラットフォームです。

[简体中文](./README.md) | [繁體中文](./README_ZH_TW.md) | [English](./README_EN.md) | 日本語 | [公式サイト](https://www.ssrprompt.com)

[![License](https://img.shields.io/badge/license-GPL-blue.svg)](./LICENSE)

</div>

## v2.0 アーキテクチャ

SSRPrompt v2.0 はフロント/バック分離の新アーキテクチャで、セキュリティ・保守性・拡張性を強化しています。

- **Monorepo** - pnpm workspace によるマルチパッケージ構成
- **API Key の暗号化保管** - AES-256-GCM で機密情報を保護
- **バックエンド AI プロキシ** - モデル呼び出しはバックエンド経由、フロントに Key を置かない
- **SSE ストリーミング** - リアルタイム出力、停止/再試行に対応
- **テナント分離** - ユーザー単位でデータを分離
- **PostgreSQL** - 統一データベース

## `main` ブランチとの差分

> このブランチは v2.0 リファクタ版です。`main`（安定版）のデプロイ方法とは互換性がありません。

| 観点 | `main`（安定版） | このブランチ（v2.0） |
|---|---|---|
| パッケージ管理 | npm | pnpm workspace |
| 構成 | 単体フロント + 任意 `server/`（MySQL プロキシ） | Monorepo：`packages/client` + `packages/server` + `packages/shared` |
| DB | Supabase（PostgreSQL）/ MySQL；Demo で手軽に試せる | PostgreSQL のみ；Prisma で Schema 管理 |
| モデル呼び出し & Key | 主にフロントから呼び出し | バックエンドで一元管理；Key は暗号化 |
| 認証 | フロントのアクセスパス（`VITE_APP_PASSWORD`） | JWT + Refresh Token；Demo は 7 日 |
| 設定 | 主に UI | 主にバックエンド `.env` |
| 起動 | フロントのみも可能 | バックエンド必須（推奨：`pnpm dev:all`） |

## 機能

### コア

- **Prompt ワークスペース** - 変数、多ターン、構造化出力を含む Prompt の作成/管理
- **操作の高速化** - ワンクリック複製、安全な削除（確認あり）
- **Prompt ウィザード** - テンプレートから会話形式で Prompt を生成
- **評価センター** - テストケースと評価基準（AI 採点）で比較評価
- **履歴/トレース** - Token・遅延・添付・OCR など実行履歴を確認
- **最適化** - AI による分析と改善提案

### 高度な機能

- **複数プロバイダー** - OpenAI / Anthropic / Google Gemini / OpenRouter / custom
- **推論モデル** - Thinking（推論過程）の表示（例：Claude / DeepSeek R1）
- **添付ファイル** - 画像/PDF/テキストをコンテキストとして利用（自動 vision/OCR）
- **バージョン管理** - 履歴・差分
- **ストリーミング** - SSE 出力、停止/再試行

### プラットフォーム

- **Demo モード** - すぐ試せる（7 日）
- **多言語** - zh-CN / zh-TW / en / ja
- **テーマ** - ライト/ダーク
- **JWT 認証**

## ハイライト

- **セキュア設計**：API Key はバックエンドのみに保存し、AES-256-GCM で暗号化。フロントは Key に触れません。
- **可観測性**：Prompt 実行〜評価まで、トレースで入出力、Thinking、遅延/Token、添付、OCR 結果を確認できます。
- **マルチモーダル**：画像/PDF/テキスト添付に対応し、モデル能力に応じて vision/OCR を自動選択できます。
- **評価可能**：テストケース + 評価基準（AI 採点）で比較評価し、CSV でエクスポートできます。

## ページと機能分布

| ページ | ルート | 主な機能 |
|---|---|---|
| ホーム | `/` | ウィザード / ワークスペース / 広場への入口 |
| Prompt ウィザード | `/wizard` | テンプレ選択 → 会話生成 → 保存 |
| Prompt ワークスペース | `/prompts` | Prompt/グループ、変数、Schema、パラメータ、テスト、履歴/差分、公開、観測/最適化 |
| Prompt 広場 | `/plaza` | 公開 Prompt を閲覧、バージョン表示、コピーして編集 |
| 評価 | `/evaluation` | テストケース/評価基準、実行、比較、CSV 出力 |
| トレース | `/traces` | 一覧/検索、入出力、Thinking、パラメータ、遅延/Token、添付/OCR |
| 設定 | `/settings` | プロバイダー/モデル、最適化、OCR、ユーザー管理（管理者） |
| 認証 | `/login` `/forgot-password` | メール/パスワード、OAuth、Demo |

## 使い方（0 → 1）

1. ログイン：メール/パスワード、または OAuth（Google/Linux.do）。まず Demo でも OK。
2. モデル設定：`設定 → Providers` でプロバイダーと API Key を追加し、モデルを追加/有効化。
3. Prompt 作成：
   - 初心者：ウィザードでテンプレから生成し保存。
   - 上級者：ワークスペースで直接編集（多ターン/変数/構造化出力）。
4. デバッグ：モデル選択、変数入力、パラメータ調整。ストリーミング出力、Thinking、添付と OCR に対応。
5. 評価：テストケースと評価基準（AI 採点）で一括実行し、結果を比較。CSV 出力も可能。
6. 共有：広場へ公開、または他者の Prompt をコピーして再利用。

## 前提依存（必須 / 任意）

必須：

- PostgreSQL（バックエンドのデータ保存）

任意（必要に応じて）：

- S3 互換オブジェクトストレージ（添付のアップロード/プレビュー、OCR の結果・中間ファイル）
- SMTP（メール認証/パスワードリセット）
- OAuth（Google / Linux.do）
- 評価 Worker（本番は `EVALUATION_QUEUE_DRIVER=pg` + worker 推奨。開発は `pnpm dev:all` / `pnpm dev:worker`）

## クイックスタート（開発）

### 要件

- Node.js >= 18
- pnpm >= 8
- PostgreSQL >= 14

### インストール

```bash
git clone https://github.com/innocentshen/ssrprompt.git
cd ssrprompt
pnpm install
```

### 設定

```bash
cp packages/server/.env.example packages/server/.env
# DATABASE_URL, JWT_SECRET, ENCRYPTION_KEY を設定
```

### DB 初期化

```bash
pnpm db:generate
pnpm db:push
pnpm db:studio
pnpm --filter @ssrprompt/server prisma:seed
```

### 起動

```bash
pnpm dev:all        # client + server + worker

# or separately
pnpm dev
pnpm dev:server
pnpm dev:worker
```

## OAuth（ソーシャルログイン）

バックエンドに環境変数を設定し、各 OAuth アプリの「コールバック URL」も同じ値にしてください：

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

- `CORS_ORIGIN` にフロントの Origin（例：`https://www.your-domain.com`）を含めてください。
- フロント/バック分離（Vercel + Zeabur 等）の場合、**コールバック URL は必ずバックエンド（Express）のドメイン**を指定してください。フロント側に設定すると SPA ルーティングに吸収され、「ホームへ戻るがログインできない」現象が起こります。
- 誤設定の緩和として、フロント側に `/api/v1/auth/oauth/:provider/callback`（`google` / `linuxdo` のみ）の転送ルートがあり、`${VITE_API_URL}/auth/oauth/:provider/callback` にクエリをそのまま転送します。

## API ドキュメント

Swagger：`http://localhost:3001/api-docs`
