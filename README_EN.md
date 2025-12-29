<div align="center">

# SSRPrompt

A modern AI Prompt development and evaluation platform that helps developers develop, test, and manage AI Prompts more efficiently.

English | [日本語](./README_JA.md) | [简体中文](./README.md) | [Official Website](https://www.ssrprompt.com)

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/innocentshen/ssrprompt)
[![License](https://img.shields.io/badge/license-GPL-blue.svg)](./LICENSE)

</div>

## Features

### Core Features

- **Prompt Development** - Visual interface for developing and managing AI Prompts with variables, multi-turn conversations, and structured output
- **Prompt Creation Wizard** - AI-driven conversational Prompt creation workflow with template quick start
- **Evaluation Center** - Systematic evaluation and comparison of Prompts with custom criteria and AI scoring
- **History Tracking** - Track and view Prompt execution history with token consumption and latency statistics
- **Smart Optimization** - AI-driven Prompt analysis and optimization suggestions

### Advanced Features

- **Multi-Model Support** - Support for OpenAI, Anthropic, Google Gemini, Azure OpenAI, DeepSeek, and more
- **Reasoning Model Support** - Display Thinking output for reasoning models like Claude 3.5 and DeepSeek R1
- **Attachment Support** - Support for images, PDFs, documents, and other file types as context (vision models)
- **Version Management** - Prompt version history and comparison
- **Database Migration** - Automatic detection and upgrade of database structure with smooth upgrades

### Platform Features

- **Demo Space** - Quick experience without database configuration (tenant isolation mode)
- **Multi-Database Support** - Support for Supabase (cloud) and MySQL (self-hosted)
- **Multi-Language Support** - Support for Simplified Chinese, Traditional Chinese, English, and Japanese
- **Frontend Configuration** - Configure database and AI providers directly in settings without code changes
- **Theme Switching** - Support for light and dark themes
- **Access Control** - Password protection for data security
- **Setup Wizard** - Guide users through initial configuration

## Tech Stack

### Frontend
- **Framework**: React 18 + TypeScript
- **Build Tool**: Vite 5
- **Styling**: Tailwind CSS 3
- **State Management**: Zustand
- **Internationalization**: i18next + react-i18next
- **UI Components**: Custom component library + Lucide React icons
- **Database Client**: Supabase JS

### Backend
- **Framework**: Express.js + TypeScript
- **Database**: MySQL 8 / PostgreSQL (Supabase)
- **Development Tools**: tsx + nodemon

## Quick Start

### Requirements

- Node.js >= 18
- npm >= 9

### Install Dependencies

```bash
# Install frontend dependencies
npm install

# Install backend dependencies (if using MySQL)
cd server && npm install
```

### Start the Project

```bash
# Start both frontend and backend (recommended)
npm run dev:all

# Or start frontend only (using Supabase or Demo mode)
npm run dev
```

### Access the Application

- **Frontend**: http://localhost:5173
- **Backend API**: http://localhost:3001

Default password: `admin123`

## Usage Modes

The project supports two usage modes:

### Demo Space (Quick Experience)

Start using immediately without any configuration. Demo Space uses a pre-configured database, with each user's data isolated by unique ID.

**Use Cases**:
- Quick feature exploration
- Temporary testing and demos
- No need for long-term data storage

### Personal Space (Private Deployment)

Use your own database configuration for complete control over data storage.

**Use Cases**:
- Production environment
- High data security requirements
- Long-term data management needs

## Database Configuration

The project supports two database options, configurable in **Settings > Database**.

### Option 1: Supabase (Recommended for Quick Start)

**Advantages**:
- Generous free tier, suitable for individuals and small teams
- Zero configuration, no local database or backend service needed
- Automatic backup and high availability
- Visual management interface

**Setup Steps**:
1. Create a free project at [supabase.com](https://supabase.com)
2. Get Project URL and Anon Key from Settings > API
3. Select Supabase in app settings and enter connection info
4. Click **Initialize Tables**, copy SQL to Supabase SQL Editor and execute
5. Click **Test Connection**, save configuration after success

### Option 2: MySQL (Recommended for Private Deployment)

**Advantages**:
- Complete data control
- No bandwidth limits
- Suitable for enterprise intranet deployment

**Setup Steps**:
1. Ensure backend service is running: `npm run dev:all`
2. Select MySQL in app settings and enter connection info
3. Click **Test Connection** to verify configuration
4. Click **Initialize Tables** to create database tables
5. Save configuration

### Database Upgrade

When project updates involve database structure changes:

- **MySQL Users**: Version is automatically detected after connection test, click "Upgrade Tables" button for one-click upgrade
- **Supabase Users**: After connection test, if updates are available, click "Upgrade Tables" to get upgrade SQL, execute manually

## Project Structure

```
.
├── src/                          # Frontend source code
│   ├── components/              # React components
│   │   ├── Common/             # Common components
│   │   ├── Evaluation/         # Evaluation components
│   │   ├── Layout/             # Layout components
│   │   ├── Prompt/             # Prompt editing components
│   │   ├── Settings/           # Settings components
│   │   ├── Setup/              # Setup wizard components
│   │   └── ui/                 # UI components
│   ├── contexts/               # React Context
│   ├── lib/                    # Utility libraries
│   │   ├── database/           # Database abstraction layer
│   │   │   ├── migrations/     # Database migration files
│   │   │   ├── index.ts        # Database initialization
│   │   │   ├── types.ts        # Type definitions
│   │   │   ├── supabase-adapter.ts
│   │   │   └── mysql-adapter.ts
│   │   ├── ai-service.ts       # AI service calls
│   │   ├── tenant.ts           # Tenant/space management
│   │   └── prompt-analyzer.ts  # Prompt analyzer
│   ├── locales/                # Multi-language translation files
│   │   ├── en/                 # English
│   │   ├── ja/                 # Japanese
│   │   ├── zh-CN/              # Simplified Chinese
│   │   └── zh-TW/              # Traditional Chinese
│   ├── pages/                  # Page components
│   │   ├── HomePage.tsx        # Home page
│   │   ├── PromptsPage.tsx     # Prompt development
│   │   ├── PromptWizardPage.tsx # Prompt creation wizard
│   │   ├── EvaluationPage.tsx  # Evaluation center
│   │   ├── TracesPage.tsx      # History tracking
│   │   ├── SettingsPage.tsx    # Settings
│   │   └── LoginPage.tsx       # Login/space selection
│   └── types/                  # TypeScript types
├── server/                      # Backend source code (MySQL proxy)
│   └── src/
│       ├── routes/             # API routes
│       ├── services/           # Database services
│       └── utils/              # Utility functions
├── public/                      # Static assets
└── package.json
```

## Database Tables

The project contains 11 database tables:

| Table | Description |
|-------|-------------|
| `schema_migrations` | Migration version records |
| `providers` | AI provider configurations |
| `models` | Model information (with vision/reasoning capability flags) |
| `prompts` | Prompt management |
| `prompt_versions` | Prompt version history |
| `evaluations` | Evaluation projects |
| `test_cases` | Test cases |
| `evaluation_criteria` | Evaluation criteria |
| `evaluation_runs` | Evaluation run records |
| `test_case_results` | Test results |
| `traces` | Call trace logs |

## Available Scripts

```bash
# Development
npm run dev          # Start frontend dev server
npm run dev:server   # Start backend dev server
npm run dev:all      # Start both frontend and backend

# Build
npm run build        # Build frontend
npm run build:server # Build backend

# Code Quality
npm run lint         # ESLint check
npm run typecheck    # TypeScript type check
```

## Environment Variables

Copy `.env.example` to `.env` (optional, can also configure in settings page):

```env
# Access password (default: admin123, change in production)
VITE_APP_PASSWORD=admin123

# MySQL proxy server configuration (required for MySQL)
VITE_MYSQL_PROXY_URL=http://localhost:3001/api/mysql-proxy
VITE_MYSQL_PROXY_API_KEY=your_secure_api_key_here

# Demo space database configuration (optional, for quick experience)
# Supabase configuration
VITE_DEMO_DB_PROVIDER=supabase
VITE_DEMO_SUPABASE_URL=your_supabase_url
VITE_DEMO_SUPABASE_ANON_KEY=your_supabase_anon_key

# Or MySQL configuration
# VITE_DEMO_DB_PROVIDER=mysql
# VITE_DEMO_MYSQL_HOST=localhost
# VITE_DEMO_MYSQL_PORT=3306
# VITE_DEMO_MYSQL_DATABASE=ssrprompt_demo
# VITE_DEMO_MYSQL_USER=root
# VITE_DEMO_MYSQL_PASSWORD=password
```

## Deployment

### Vercel One-Click Deployment (Recommended)

Click the button below to deploy to Vercel with one click:

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/innocentshen/ssrprompt)

### Zeabur Deployment

The project is adapted for the Zeabur platform and supports one-click deployment.

### Docker Deployment

```bash
docker-compose up -d
```

For detailed deployment guide, please refer to [DEPLOYMENT.md](./DEPLOYMENT.md)

## Security Tips

- Default password `admin123` is for development only, change in production
- API Keys should use strong random strings
- Enable HTTPS in production
- Supabase Anon Key is public, data is protected by RLS policies
- Demo Space data is isolated by user unique ID, but data privacy is not guaranteed

## Development Guide

### Database Migration

When modifying database table structure, please refer to the database migration specification in [CLAUDE.md](./CLAUDE.md).

Current migration versions:
- 001: Initial table structure
- 003: Model vision capability support
- 004: Reasoning model support (Thinking)
- 005: Evaluation model parameter extension

### Code Standards

The project uses ESLint + TypeScript for code quality checks:

```bash
npm run lint
npm run typecheck
```

## License

GPL

## Contributing

Issues and Pull Requests are welcome!

## Related Links

- [Supabase Configuration Guide](./SUPABASE.md)
- [Server Deployment Guide](./DEPLOYMENT.md)
- [Development Standards](./CLAUDE.md)
