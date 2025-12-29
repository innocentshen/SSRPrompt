<div align="center">

# SSRPrompt

一个现代化的 AI Prompt 开发和评测平台，帮助开发者更高效地开发、测试和管理 AI Prompts。

[English](./README_EN.md) | [日本語](./README_JA.md) | 简体中文 | [官网](https://www.ssrprompt.com)

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/innocentshen/ssrprompt)
[![License](https://img.shields.io/badge/license-GPL-blue.svg)](./LICENSE)

</div>

## 功能特性

### 核心功能

- **Prompt 开发** - 可视化界面开发和管理 AI Prompts，支持变量、多轮对话、结构化输出
- **Prompt 创建向导** - AI 驱动的对话式 Prompt 创建流程，支持模板快速开始
- **评测中心** - 对 Prompts 进行系统化评测和对比，支持自定义评价标准和 AI 评分
- **历史记录** - 追踪和查看 Prompt 执行历史，包含 Token 消耗和延迟统计
- **智能优化** - AI 驱动的 Prompt 分析和优化建议

### 高级特性

- **多模型支持** - 支持 OpenAI、Anthropic、Google Gemini、Azure OpenAI、DeepSeek 等多种 AI 服务商
- **推理模型支持** - 支持 Claude 3.5、DeepSeek R1 等推理模型的 Thinking 输出展示
- **附件支持** - 支持图片、PDF、文档等多种文件类型作为上下文（视觉模型）
- **版本管理** - Prompt 版本历史和对比功能
- **数据库迁移** - 自动检测和升级数据库结构，支持平滑升级

### 平台特性

- **Demo 空间** - 无需配置数据库即可快速体验系统（租户隔离模式）
- **多数据库支持** - 支持 Supabase（云端）和 MySQL（自建）两种数据库
- **多语言支持** - 支持简体中文、繁体中文、英文、日文
- **前端配置** - 无需修改代码，直接在设置页面配置数据库和 AI 服务商
- **主题切换** - 支持明暗主题切换
- **访问控制** - 密码保护确保数据安全
- **首次配置向导** - 引导用户完成初始设置

## 技术栈

### 前端
- **框架**: React 18 + TypeScript
- **构建工具**: Vite 5
- **样式**: Tailwind CSS 3
- **状态管理**: Zustand
- **国际化**: i18next + react-i18next
- **UI 组件**: 自定义组件库 + Lucide React 图标
- **数据库客户端**: Supabase JS

### 后端
- **框架**: Express.js + TypeScript
- **数据库**: MySQL 8 / PostgreSQL (Supabase)
- **开发工具**: tsx + nodemon

## 快速开始

### 环境要求

- Node.js >= 18
- npm >= 9

### 安装依赖

```bash
# 安装前端依赖
npm install

# 安装后端依赖（如需使用 MySQL）
cd server && npm install
```

### 启动项目

```bash
# 同时启动前端和后端（推荐）
npm run dev:all

# 或仅启动前端（使用 Supabase 或 Demo 模式）
npm run dev
```

### 访问应用

- **前端**: http://localhost:5173
- **后端 API**: http://localhost:3001

默认密码：`admin123`

## 使用模式

项目支持两种使用模式：

### Demo 空间（快速体验）

无需任何配置即可立即开始使用。Demo 空间使用预配置的数据库，每个用户的数据通过唯一 ID 进行隔离。

**适用场景**：
- 快速了解产品功能
- 临时测试和演示
- 无需长期保存数据的使用

### 个人空间（私有部署）

使用自己的数据库配置，完全控制数据存储。

**适用场景**：
- 生产环境使用
- 数据安全性要求高
- 需要长期保存和管理数据

## 数据库配置

项目支持两种数据库方案，可以在应用的 **设置 > 数据库** 页面直接配置。

### 方案 1：Supabase（推荐快速开始）

**优点**：
- 免费额度充足，适合个人和小团队
- 零配置，无需本地数据库和后端服务
- 自动备份和高可用
- 提供可视化管理界面

**配置步骤**：
1. 在 [supabase.com](https://supabase.com) 创建免费项目
2. 从 Settings > API 获取 Project URL 和 Anon Key
3. 在应用设置页面选择 Supabase，填入连接信息
4. 点击 **初始化表结构**，复制 SQL 到 Supabase SQL Editor 执行
5. 点击 **测试连接**，成功后保存配置

### 方案 2：MySQL（推荐私有部署）

**优点**：
- 完全控制数据
- 无带宽限制
- 适合企业内网部署

**配置步骤**：
1. 确保后端服务已启动：`npm run dev:all`
2. 在应用设置页面选择 MySQL，填入连接信息
3. 点击 **测试连接** 验证配置
4. 点击 **初始化表结构** 创建数据表
5. 保存配置

### 数据库升级

当项目更新涉及数据库结构变更时：

- **MySQL 用户**：测试连接后会自动检测版本，点击"升级表结构"按钮一键升级
- **Supabase 用户**：测试连接后如有更新，点击"升级表结构"获取升级 SQL，手动执行

## 项目结构

```
.
├── src/                          # 前端源码
│   ├── components/              # React 组件
│   │   ├── Common/             # 通用组件
│   │   ├── Evaluation/         # 评测相关组件
│   │   ├── Layout/             # 布局组件
│   │   ├── Prompt/             # Prompt 编辑相关组件
│   │   ├── Settings/           # 设置相关组件
│   │   ├── Setup/              # 初始化向导组件
│   │   └── ui/                 # 通用 UI 组件
│   ├── contexts/               # React Context
│   ├── lib/                    # 工具库
│   │   ├── database/           # 数据库抽象层
│   │   │   ├── migrations/     # 数据库迁移文件
│   │   │   ├── index.ts        # 数据库初始化
│   │   │   ├── types.ts        # 类型定义
│   │   │   ├── supabase-adapter.ts
│   │   │   └── mysql-adapter.ts
│   │   ├── ai-service.ts       # AI 服务调用
│   │   ├── tenant.ts           # 租户/空间管理
│   │   └── prompt-analyzer.ts  # Prompt 分析器
│   ├── locales/                # 多语言翻译文件
│   │   ├── en/                 # 英文
│   │   ├── ja/                 # 日文
│   │   ├── zh-CN/              # 简体中文
│   │   └── zh-TW/              # 繁体中文
│   ├── pages/                  # 页面组件
│   │   ├── HomePage.tsx        # 首页引导
│   │   ├── PromptsPage.tsx     # Prompt 开发
│   │   ├── PromptWizardPage.tsx # Prompt 创建向导
│   │   ├── EvaluationPage.tsx  # 评测中心
│   │   ├── TracesPage.tsx      # 历史记录
│   │   ├── SettingsPage.tsx    # 设置
│   │   └── LoginPage.tsx       # 登录/空间选择
│   └── types/                  # TypeScript 类型
├── server/                      # 后端源码（MySQL 代理）
│   └── src/
│       ├── routes/             # API 路由
│       ├── services/           # 数据库服务
│       └── utils/              # 工具函数
├── public/                      # 静态资源
└── package.json
```

## 数据库表结构

项目包含 11 张数据表：

| 表名 | 说明 |
|------|------|
| `schema_migrations` | 迁移版本记录 |
| `providers` | AI 服务商配置 |
| `models` | 模型信息（含视觉/推理能力标识） |
| `prompts` | Prompt 管理 |
| `prompt_versions` | Prompt 版本历史 |
| `evaluations` | 评测项目 |
| `test_cases` | 测试用例 |
| `evaluation_criteria` | 评价标准 |
| `evaluation_runs` | 评测运行记录 |
| `test_case_results` | 测试结果 |
| `traces` | 调用追踪日志 |

## 可用脚本

```bash
# 开发
npm run dev          # 启动前端开发服务器
npm run dev:server   # 启动后端开发服务器
npm run dev:all      # 同时启动前后端

# 构建
npm run build        # 构建前端
npm run build:server # 构建后端

# 代码质量
npm run lint         # ESLint 检查
npm run typecheck    # TypeScript 类型检查
```

## 环境变量

复制 `.env.example` 到 `.env`（可选，也可在设置页面配置）：

```env
# 访问密码（默认：admin123，生产环境请修改）
VITE_APP_PASSWORD=admin123

# MySQL 代理服务器配置（使用 MySQL 时需要）
VITE_MYSQL_PROXY_URL=http://localhost:3001/api/mysql-proxy
VITE_MYSQL_PROXY_API_KEY=your_secure_api_key_here

# Demo 空间数据库配置（可选，用于快速体验功能）
# Supabase 配置
VITE_DEMO_DB_PROVIDER=supabase
VITE_DEMO_SUPABASE_URL=your_supabase_url
VITE_DEMO_SUPABASE_ANON_KEY=your_supabase_anon_key

# 或 MySQL 配置
# VITE_DEMO_DB_PROVIDER=mysql
# VITE_DEMO_MYSQL_HOST=localhost
# VITE_DEMO_MYSQL_PORT=3306
# VITE_DEMO_MYSQL_DATABASE=ssrprompt_demo
# VITE_DEMO_MYSQL_USER=root
# VITE_DEMO_MYSQL_PASSWORD=password
```

## 部署

### Vercel 一键部署（推荐）

点击下方按钮即可一键部署到 Vercel：

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/innocentshen/ssrprompt)

### Zeabur 部署

项目已适配 Zeabur 平台，支持一键部署。

### Docker 部署

```bash
docker-compose up -d
```

详细部署指南请参考 [DEPLOYMENT.md](./DEPLOYMENT.md)

## 安全提示

- 默认密码 `admin123` 仅用于开发环境，生产环境务必修改
- API Key 应使用强随机字符串
- 建议在生产环境启用 HTTPS
- Supabase Anon Key 是公开密钥，通过 RLS 策略保护数据安全
- Demo 空间数据通过用户唯一 ID 进行隔离，但不保证数据隐私性

## 开发指南

### 数据库迁移

当需要修改数据库表结构时，请参考 [CLAUDE.md](./CLAUDE.md) 中的数据库迁移规范。

当前迁移版本：
- 001: 初始表结构
- 003: 模型视觉能力支持
- 004: 推理模型支持（Thinking）
- 005: 评测模型参数扩展

### 代码规范

项目使用 ESLint + TypeScript 进行代码质量检查：

```bash
npm run lint
npm run typecheck
```

## 许可证

GPL

## 贡献

欢迎提交 Issue 和 Pull Request！

## 相关链接

- [Supabase 配置指南](./SUPABASE.md)
- [服务器部署指南](./DEPLOYMENT.md)
- [开发规范](./CLAUDE.md)
