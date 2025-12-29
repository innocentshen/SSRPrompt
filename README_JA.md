<div align="center">

# SSRPrompt

AI プロンプトの開発・評価を支援するモダンなプラットフォーム。開発者がより効率的に AI プロンプトを開発、テスト、管理できます。

[English](./README_EN.md) | 日本語 | [简体中文](./README.md) | [公式サイト](https://www.ssrprompt.com)

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/innocentshen/ssrprompt)
[![License](https://img.shields.io/badge/license-GPL-blue.svg)](./LICENSE)

</div>

## 機能

### コア機能

- **プロンプト開発** - 変数、マルチターン会話、構造化出力をサポートする視覚的インターフェースでAIプロンプトを開発・管理
- **プロンプト作成ウィザード** - テンプレートからすぐに始められるAI駆動の対話型プロンプト作成フロー
- **評価センター** - カスタム基準とAIスコアリングによるプロンプトの体系的な評価と比較
- **履歴追跡** - トークン消費量と遅延統計を含むプロンプト実行履歴の追跡と表示
- **スマート最適化** - AI駆動のプロンプト分析と最適化提案

### 高度な機能

- **マルチモデルサポート** - OpenAI、Anthropic、Google Gemini、Azure OpenAI、DeepSeekなど多数のAIプロバイダーに対応
- **推論モデルサポート** - Claude 3.5、DeepSeek R1などの推論モデルのThinking出力を表示
- **添付ファイルサポート** - 画像、PDF、ドキュメントなど各種ファイルタイプをコンテキストとしてサポート（ビジョンモデル）
- **バージョン管理** - プロンプトのバージョン履歴と比較機能
- **データベースマイグレーション** - データベース構造の自動検出とスムーズなアップグレード

### プラットフォーム機能

- **デモスペース** - データベース設定なしですぐに体験可能（テナント分離モード）
- **マルチデータベースサポート** - Supabase（クラウド）とMySQL（セルフホスト）に対応
- **多言語サポート** - 簡体字中国語、繁体字中国語、英語、日本語に対応
- **フロントエンド設定** - コード変更なしで設定ページからデータベースとAIプロバイダーを設定
- **テーマ切り替え** - ライトテーマとダークテーマをサポート
- **アクセス制御** - パスワード保護によるデータセキュリティ
- **セットアップウィザード** - 初期設定をガイド

## 技術スタック

### フロントエンド
- **フレームワーク**: React 18 + TypeScript
- **ビルドツール**: Vite 5
- **スタイリング**: Tailwind CSS 3
- **状態管理**: Zustand
- **国際化**: i18next + react-i18next
- **UIコンポーネント**: カスタムコンポーネントライブラリ + Lucide React アイコン
- **データベースクライアント**: Supabase JS

### バックエンド
- **フレームワーク**: Express.js + TypeScript
- **データベース**: MySQL 8 / PostgreSQL (Supabase)
- **開発ツール**: tsx + nodemon

## クイックスタート

### 要件

- Node.js >= 18
- npm >= 9

### 依存関係のインストール

```bash
# フロントエンドの依存関係をインストール
npm install

# バックエンドの依存関係をインストール（MySQLを使用する場合）
cd server && npm install
```

### プロジェクトの起動

```bash
# フロントエンドとバックエンドを同時に起動（推奨）
npm run dev:all

# またはフロントエンドのみ起動（SupabaseまたはDemoモードを使用）
npm run dev
```

### アプリケーションへのアクセス

- **フロントエンド**: http://localhost:5173
- **バックエンドAPI**: http://localhost:3001

デフォルトパスワード: `admin123`

## 使用モード

プロジェクトは2つの使用モードをサポートしています：

### デモスペース（クイック体験）

設定なしですぐに使用開始できます。デモスペースは事前設定されたデータベースを使用し、各ユーザーのデータは一意のIDで分離されます。

**ユースケース**:
- 機能のクイック探索
- 一時的なテストとデモ
- 長期的なデータ保存が不要な場合

### パーソナルスペース（プライベートデプロイ）

独自のデータベース設定を使用し、データストレージを完全に制御できます。

**ユースケース**:
- 本番環境での使用
- 高いデータセキュリティ要件
- 長期的なデータ管理が必要な場合

## データベース設定

プロジェクトは2つのデータベースオプションをサポートしており、**設定 > データベース**で設定できます。

### オプション1: Supabase（クイックスタートにおすすめ）

**メリット**:
- 寛大な無料枠、個人や小規模チームに最適
- ゼロ設定、ローカルデータベースやバックエンドサービス不要
- 自動バックアップと高可用性
- ビジュアル管理インターフェース

**セットアップ手順**:
1. [supabase.com](https://supabase.com)で無料プロジェクトを作成
2. Settings > APIからProject URLとAnon Keyを取得
3. アプリ設定でSupabaseを選択し、接続情報を入力
4. **テーブル初期化**をクリックし、SQLをSupabase SQL Editorにコピーして実行
5. **接続テスト**をクリックし、成功後に設定を保存

### オプション2: MySQL（プライベートデプロイにおすすめ）

**メリット**:
- データの完全な制御
- 帯域幅制限なし
- 企業イントラネットデプロイに最適

**セットアップ手順**:
1. バックエンドサービスが起動していることを確認: `npm run dev:all`
2. アプリ設定でMySQLを選択し、接続情報を入力
3. **接続テスト**をクリックして設定を確認
4. **テーブル初期化**をクリックしてデータベーステーブルを作成
5. 設定を保存

### データベースアップグレード

プロジェクト更新にデータベース構造の変更が含まれる場合：

- **MySQLユーザー**: 接続テスト後にバージョンが自動検出され、「テーブルアップグレード」ボタンでワンクリックアップグレード
- **Supabaseユーザー**: 接続テスト後、更新がある場合は「テーブルアップグレード」をクリックしてアップグレードSQLを取得し、手動で実行

## プロジェクト構造

```
.
├── src/                          # フロントエンドソースコード
│   ├── components/              # Reactコンポーネント
│   │   ├── Common/             # 共通コンポーネント
│   │   ├── Evaluation/         # 評価コンポーネント
│   │   ├── Layout/             # レイアウトコンポーネント
│   │   ├── Prompt/             # プロンプト編集コンポーネント
│   │   ├── Settings/           # 設定コンポーネント
│   │   ├── Setup/              # セットアップウィザードコンポーネント
│   │   └── ui/                 # UIコンポーネント
│   ├── contexts/               # React Context
│   ├── lib/                    # ユーティリティライブラリ
│   │   ├── database/           # データベース抽象化レイヤー
│   │   │   ├── migrations/     # データベースマイグレーションファイル
│   │   │   ├── index.ts        # データベース初期化
│   │   │   ├── types.ts        # 型定義
│   │   │   ├── supabase-adapter.ts
│   │   │   └── mysql-adapter.ts
│   │   ├── ai-service.ts       # AIサービス呼び出し
│   │   ├── tenant.ts           # テナント/スペース管理
│   │   └── prompt-analyzer.ts  # プロンプトアナライザー
│   ├── locales/                # 多言語翻訳ファイル
│   │   ├── en/                 # 英語
│   │   ├── ja/                 # 日本語
│   │   ├── zh-CN/              # 簡体字中国語
│   │   └── zh-TW/              # 繁体字中国語
│   ├── pages/                  # ページコンポーネント
│   │   ├── HomePage.tsx        # ホームページ
│   │   ├── PromptsPage.tsx     # プロンプト開発
│   │   ├── PromptWizardPage.tsx # プロンプト作成ウィザード
│   │   ├── EvaluationPage.tsx  # 評価センター
│   │   ├── TracesPage.tsx      # 履歴追跡
│   │   ├── SettingsPage.tsx    # 設定
│   │   └── LoginPage.tsx       # ログイン/スペース選択
│   └── types/                  # TypeScript型
├── server/                      # バックエンドソースコード（MySQLプロキシ）
│   └── src/
│       ├── routes/             # APIルート
│       ├── services/           # データベースサービス
│       └── utils/              # ユーティリティ関数
├── public/                      # 静的アセット
└── package.json
```

## データベーステーブル

プロジェクトには11のデータベーステーブルがあります：

| テーブル | 説明 |
|---------|------|
| `schema_migrations` | マイグレーションバージョン記録 |
| `providers` | AIプロバイダー設定 |
| `models` | モデル情報（ビジョン/推論機能フラグ付き） |
| `prompts` | プロンプト管理 |
| `prompt_versions` | プロンプトバージョン履歴 |
| `evaluations` | 評価プロジェクト |
| `test_cases` | テストケース |
| `evaluation_criteria` | 評価基準 |
| `evaluation_runs` | 評価実行記録 |
| `test_case_results` | テスト結果 |
| `traces` | 呼び出しトレースログ |

## 利用可能なスクリプト

```bash
# 開発
npm run dev          # フロントエンド開発サーバーを起動
npm run dev:server   # バックエンド開発サーバーを起動
npm run dev:all      # フロントエンドとバックエンドを同時起動

# ビルド
npm run build        # フロントエンドをビルド
npm run build:server # バックエンドをビルド

# コード品質
npm run lint         # ESLintチェック
npm run typecheck    # TypeScript型チェック
```

## 環境変数

`.env.example`を`.env`にコピー（オプション、設定ページでも設定可能）：

```env
# アクセスパスワード（デフォルト: admin123、本番環境では変更必須）
VITE_APP_PASSWORD=admin123

# MySQLプロキシサーバー設定（MySQL使用時に必要）
VITE_MYSQL_PROXY_URL=http://localhost:3001/api/mysql-proxy
VITE_MYSQL_PROXY_API_KEY=your_secure_api_key_here

# デモスペースデータベース設定（オプション、クイック体験用）
# Supabase設定
VITE_DEMO_DB_PROVIDER=supabase
VITE_DEMO_SUPABASE_URL=your_supabase_url
VITE_DEMO_SUPABASE_ANON_KEY=your_supabase_anon_key

# またはMySQL設定
# VITE_DEMO_DB_PROVIDER=mysql
# VITE_DEMO_MYSQL_HOST=localhost
# VITE_DEMO_MYSQL_PORT=3306
# VITE_DEMO_MYSQL_DATABASE=ssrprompt_demo
# VITE_DEMO_MYSQL_USER=root
# VITE_DEMO_MYSQL_PASSWORD=password
```

## デプロイ

### Vercelワンクリックデプロイ（推奨）

以下のボタンをクリックしてVercelにワンクリックでデプロイ：

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/innocentshen/ssrprompt)

### Zeaburデプロイ

プロジェクトはZeaburプラットフォームに対応しており、ワンクリックデプロイをサポートしています。

### Dockerデプロイ

```bash
docker-compose up -d
```

詳細なデプロイガイドは[DEPLOYMENT.md](./DEPLOYMENT.md)を参照してください。

## セキュリティに関するヒント

- デフォルトパスワード`admin123`は開発用のみ、本番環境では必ず変更
- APIキーには強力なランダム文字列を使用
- 本番環境ではHTTPSを有効化
- Supabase Anon Keyは公開キー、データはRLSポリシーで保護
- デモスペースのデータはユーザー一意IDで分離されますが、データプライバシーは保証されません

## 開発ガイド

### データベースマイグレーション

データベーステーブル構造を変更する場合は、[CLAUDE.md](./CLAUDE.md)のデータベースマイグレーション仕様を参照してください。

現在のマイグレーションバージョン：
- 001: 初期テーブル構造
- 003: モデルビジョン機能サポート
- 004: 推論モデルサポート（Thinking）
- 005: 評価モデルパラメータ拡張

### コード規約

プロジェクトはESLint + TypeScriptを使用してコード品質をチェックしています：

```bash
npm run lint
npm run typecheck
```

## ライセンス

GPL

## コントリビューション

IssueとPull Requestを歓迎します！

## 関連リンク

- [Supabase設定ガイド](./SUPABASE.md)
- [サーバーデプロイガイド](./DEPLOYMENT.md)
- [開発規約](./CLAUDE.md)
