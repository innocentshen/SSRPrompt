# SSRPrompt 数据库表结构设计

> 本文档描述 SSRPrompt 项目的完整数据库表结构设计（含方案 A 推理功能增强）

---

## 目录

1. [概述](#1-概述)
2. [ER 关系图](#2-er-关系图)
3. [表结构详情](#3-表结构详情)
4. [JSON 字段结构](#4-json-字段结构)
5. [索引设计](#5-索引设计)
6. [数据库差异](#6-数据库差异)
7. [方案 A 变更说明](#7-方案-a-变更说明)

---

## 1. 概述

### 1.1 支持的数据库

| 数据库 | 用途 | 配置文件 |
|--------|------|----------|
| MySQL | 自建部署 | `server/src/utils/schema.ts` |
| PostgreSQL (Supabase) | 云端部署 | `src/lib/database/supabase-init-sql.ts` |

### 1.2 表清单

| 序号 | 表名 | 说明 | 记录数量级 |
|------|------|------|-----------|
| 1 | `providers` | AI 服务商配置 | 小（~10） |
| 2 | `models` | 模型列表 | 小（~100） |
| 3 | `prompts` | Prompt 模板 | 中（~1000） |
| 4 | `prompt_versions` | Prompt 版本历史 | 中（~5000） |
| 5 | `evaluations` | 评测任务 | 中（~500） |
| 6 | `test_cases` | 测试用例 | 中（~5000） |
| 7 | `evaluation_criteria` | 评价标准 | 小（~1000） |
| 8 | `evaluation_runs` | 评测运行记录 | 中（~2000） |
| 9 | `test_case_results` | 测试结果 | 大（~50000） |
| 10 | `traces` | 调用追踪日志 | 大（~100000+） |
| 11 | `schema_migrations` | 迁移版本记录 | 极小（~10） |

---

## 2. ER 关系图

```
┌─────────────────┐
│   providers     │
│─────────────────│
│ id (PK)         │
│ user_id         │
│ name            │
│ type            │  ← 新增 'openrouter'
│ api_key         │
│ base_url        │
│ enabled         │
└────────┬────────┘
         │
         │ 1:N
         ▼
┌─────────────────┐
│    models       │
│─────────────────│
│ id (PK)         │
│ provider_id(FK) │◄─────────────────────────────────────┐
│ model_id        │                                      │
│ name            │                                      │
│ capabilities    │                                      │
│ supports_vision │                                      │
│ supports_reasoning 🆕                                  │
│ supports_function_calling 🆕                           │
└────────┬────────┘                                      │
         │                                               │
         │ 1:N (default_model)                           │
         ▼                                               │
┌─────────────────┐      ┌─────────────────┐             │
│    prompts      │      │ prompt_versions │             │
│─────────────────│      │─────────────────│             │
│ id (PK)         │◄────▶│ id (PK)         │             │
│ user_id         │ 1:N  │ prompt_id (FK)  │             │
│ name            │      │ version         │             │
│ description     │      │ content         │             │
│ content         │      │ commit_message  │             │
│ variables (JSON)│      └─────────────────┘             │
│ messages (JSON) │                                      │
│ config (JSON)   │                                      │
│ default_model_id│──────────────────────────────────────┘
└────────┬────────┘
         │
         │ 1:N
         ▼
┌─────────────────┐      ┌───────────────────┐      ┌─────────────────────┐
│  evaluations    │      │ evaluation_runs   │      │ evaluation_criteria │
│─────────────────│      │───────────────────│      │─────────────────────│
│ id (PK)         │◄────▶│ id (PK)           │      │ id (PK)             │
│ user_id         │ 1:N  │ evaluation_id(FK) │      │ evaluation_id (FK)  │◄┐
│ name            │      │ status            │      │ name                │ │
│ prompt_id (FK)  │      │ results (JSON)    │      │ description         │ │
│ model_id (FK)   │      │ error_message     │      │ prompt              │ │
│ judge_model_id  │      │ total_tokens_*    │      │ weight              │ │
│ status          │      └─────────┬─────────┘      │ enabled             │ │
│ config (JSON)   │                │                └─────────────────────┘ │
│ results (JSON)  │                │                                        │
└────────┬────────┘                │                                        │
         │                         │                                        │
         │ 1:N                     │ 1:N                                    │
         ▼                         ▼                                        │
┌─────────────────┐      ┌─────────────────────┐                            │
│   test_cases    │      │ test_case_results   │                            │
│─────────────────│      │─────────────────────│                            │
│ id (PK)         │◄────▶│ id (PK)             │                            │
│ evaluation_id   │ 1:N  │ evaluation_id (FK)  │────────────────────────────┘
│ name            │      │ test_case_id (FK)   │
│ input_text      │      │ run_id (FK)         │
│ input_variables │      │ model_output        │
│ attachments     │      │ scores (JSON)       │
│ expected_output │      │ ai_feedback (JSON)  │
│ notes           │      │ latency_ms          │
│ order_index     │      │ tokens_input/output │
└─────────────────┘      │ passed              │
                         │ error_message       │
                         └─────────────────────┘

┌─────────────────┐
│    traces       │  （独立表，记录所有 AI 调用）
│─────────────────│
│ id (PK)         │
│ user_id         │
│ prompt_id (FK)  │
│ model_id (FK)   │
│ input           │
│ output          │
│ thinking_content 🆕  ← 思考/推理内容
│ thinking_time_ms 🆕  ← 思考耗时
│ tokens_*        │
│ latency_ms      │
│ status          │
│ error_message   │
│ metadata (JSON) │
│ attachments     │
└─────────────────┘
```

---

## 3. 表结构详情

### 3.1 providers（服务商表）

存储 AI 服务商的配置信息。

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| `id` | UUID/VARCHAR(36) | PK | 主键 |
| `user_id` | UUID/VARCHAR(36) | NOT NULL | 用户 ID |
| `name` | VARCHAR(255) | NOT NULL | 服务商名称 |
| `type` | ENUM | NOT NULL | 类型：openai/anthropic/gemini/azure/custom/openrouter |
| `api_key` | TEXT | NOT NULL | API 密钥（支持多个，逗号分隔） |
| `base_url` | TEXT | NULL | 自定义 API 地址 |
| `enabled` | BOOLEAN | DEFAULT FALSE | 是否启用 |
| `created_at` | TIMESTAMP | DEFAULT NOW | 创建时间 |
| `updated_at` | TIMESTAMP | DEFAULT NOW | 更新时间 |

**TypeScript 类型：**
```typescript
type ProviderType = 'openai' | 'anthropic' | 'gemini' | 'azure' | 'custom' | 'openrouter';

interface Provider {
  id: string;
  user_id: string;
  name: string;
  type: ProviderType;
  api_key: string;
  base_url: string | null;
  enabled: boolean;
  created_at: string;
  updated_at: string;
}
```

---

### 3.2 models（模型表）

存储各服务商下的模型列表。

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| `id` | UUID/VARCHAR(36) | PK | 主键 |
| `provider_id` | UUID/VARCHAR(36) | FK, NOT NULL | 关联服务商 |
| `model_id` | VARCHAR(255) | NOT NULL | 模型标识（如 gpt-4o） |
| `name` | VARCHAR(255) | NOT NULL | 显示名称 |
| `capabilities` | JSON/TEXT[] | NULL | 能力列表（预留） |
| `supports_vision` | BOOLEAN | DEFAULT TRUE | 是否支持视觉 |
| `supports_reasoning` | BOOLEAN | DEFAULT FALSE | 是否支持推理/思考 🆕 |
| `supports_function_calling` | BOOLEAN | DEFAULT FALSE | 是否支持工具调用 🆕 |
| `created_at` | TIMESTAMP | DEFAULT NOW | 创建时间 |

**TypeScript 类型：**
```typescript
interface Model {
  id: string;
  provider_id: string;
  model_id: string;
  name: string;
  capabilities: string[];
  supports_vision: boolean;
  supports_reasoning: boolean;        // 🆕 方案 A 新增
  supports_function_calling: boolean; // 🆕 方案 A 新增
  created_at: string;
}
```

---

### 3.3 prompts（Prompt 表）

存储 Prompt 模板。

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| `id` | UUID/VARCHAR(36) | PK | 主键 |
| `user_id` | UUID/VARCHAR(36) | NOT NULL | 用户 ID |
| `name` | VARCHAR(255) | NOT NULL | Prompt 名称 |
| `description` | TEXT | NULL | 描述 |
| `content` | TEXT | NULL | 内容（旧版单消息模式） |
| `variables` | JSON | DEFAULT [] | 变量定义 |
| `messages` | JSON | DEFAULT [] | 多轮消息 |
| `config` | JSON | DEFAULT {} | 模型参数配置 |
| `current_version` | INT | DEFAULT 1 | 当前版本号 |
| `default_model_id` | UUID/VARCHAR(36) | FK, NULL | 默认模型 |
| `order_index` | INT | DEFAULT 0 | 排序索引 |
| `created_at` | TIMESTAMP | DEFAULT NOW | 创建时间 |
| `updated_at` | TIMESTAMP | DEFAULT NOW | 更新时间 |

**TypeScript 类型：**
```typescript
interface Prompt {
  id: string;
  user_id: string;
  name: string;
  description: string;
  content: string;
  variables: PromptVariable[];
  messages: PromptMessage[];
  config: PromptConfig;
  current_version: number;
  default_model_id: string | null;
  order_index: number;
  created_at: string;
  updated_at: string;
}
```

---

### 3.4 prompt_versions（Prompt 版本表）

存储 Prompt 的历史版本。

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| `id` | UUID/VARCHAR(36) | PK | 主键 |
| `prompt_id` | UUID/VARCHAR(36) | FK, NOT NULL | 关联 Prompt |
| `version` | INT | NOT NULL | 版本号 |
| `content` | TEXT | NOT NULL | 版本内容 |
| `commit_message` | TEXT | NULL | 提交说明 |
| `created_at` | TIMESTAMP | DEFAULT NOW | 创建时间 |

---

### 3.5 evaluations（评测表）

存储评测任务。

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| `id` | UUID/VARCHAR(36) | PK | 主键 |
| `user_id` | UUID/VARCHAR(36) | NOT NULL | 用户 ID |
| `name` | VARCHAR(255) | NOT NULL | 评测名称 |
| `prompt_id` | UUID/VARCHAR(36) | FK, NULL | 关联 Prompt |
| `model_id` | UUID/VARCHAR(36) | FK, NULL | 被测模型 |
| `judge_model_id` | UUID/VARCHAR(36) | FK, NULL | 评判模型 |
| `status` | ENUM | DEFAULT 'pending' | 状态：pending/running/completed/failed |
| `config` | JSON | DEFAULT {} | 评测配置 |
| `results` | JSON | DEFAULT {} | 评测结果 |
| `created_at` | TIMESTAMP | DEFAULT NOW | 创建时间 |
| `completed_at` | TIMESTAMP | NULL | 完成时间 |

**TypeScript 类型：**
```typescript
type EvaluationStatus = 'pending' | 'running' | 'completed' | 'failed';

interface Evaluation {
  id: string;
  user_id: string;
  name: string;
  prompt_id: string | null;
  model_id: string | null;
  judge_model_id: string | null;
  status: EvaluationStatus;
  config: EvaluationConfig;
  results: EvaluationResults;
  created_at: string;
  completed_at: string | null;
}
```

---

### 3.6 test_cases（测试用例表）

存储评测的测试用例。

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| `id` | UUID/VARCHAR(36) | PK | 主键 |
| `evaluation_id` | UUID/VARCHAR(36) | FK, NOT NULL | 关联评测 |
| `name` | VARCHAR(255) | DEFAULT '' | 用例名称 |
| `input_text` | TEXT | NOT NULL | 输入文本 |
| `input_variables` | JSON | DEFAULT {} | 输入变量 |
| `attachments` | JSON | DEFAULT [] | 附件（文件/图片） |
| `expected_output` | TEXT | NULL | 期望输出 |
| `notes` | TEXT | NULL | 备注 |
| `order_index` | INT | DEFAULT 0 | 排序索引 |
| `created_at` | TIMESTAMP | DEFAULT NOW | 创建时间 |

---

### 3.7 evaluation_criteria（评价标准表）

存储评测的评价标准。

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| `id` | UUID/VARCHAR(36) | PK | 主键 |
| `evaluation_id` | UUID/VARCHAR(36) | FK, NOT NULL | 关联评测 |
| `name` | VARCHAR(255) | NOT NULL | 标准名称 |
| `description` | TEXT | NULL | 描述 |
| `prompt` | TEXT | NULL | 评判 Prompt |
| `weight` | DECIMAL(5,2) | DEFAULT 1.0 | 权重 |
| `enabled` | BOOLEAN | DEFAULT TRUE | 是否启用 |
| `created_at` | TIMESTAMP | DEFAULT NOW | 创建时间 |

---

### 3.8 evaluation_runs（评测运行表）

存储每次评测运行的记录。

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| `id` | UUID/VARCHAR(36) | PK | 主键 |
| `evaluation_id` | UUID/VARCHAR(36) | FK, NOT NULL | 关联评测 |
| `status` | ENUM | DEFAULT 'pending' | 运行状态 |
| `results` | JSON | DEFAULT {} | 运行结果 |
| `error_message` | TEXT | NULL | 错误信息 |
| `total_tokens_input` | INT | DEFAULT 0 | 总输入 Token |
| `total_tokens_output` | INT | DEFAULT 0 | 总输出 Token |
| `started_at` | TIMESTAMP | DEFAULT NOW | 开始时间 |
| `completed_at` | TIMESTAMP | NULL | 完成时间 |
| `created_at` | TIMESTAMP | DEFAULT NOW | 创建时间 |

---

### 3.9 test_case_results（测试结果表）

存储每个测试用例的执行结果。

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| `id` | UUID/VARCHAR(36) | PK | 主键 |
| `evaluation_id` | UUID/VARCHAR(36) | FK, NOT NULL | 关联评测 |
| `test_case_id` | UUID/VARCHAR(36) | FK, NOT NULL | 关联用例 |
| `run_id` | UUID/VARCHAR(36) | FK, NULL | 关联运行记录 |
| `model_output` | TEXT | NOT NULL | 模型输出 |
| `scores` | JSON | DEFAULT {} | 各标准得分 |
| `ai_feedback` | JSON | DEFAULT {} | AI 评判反馈 |
| `latency_ms` | INT | DEFAULT 0 | 响应延迟(ms) |
| `tokens_input` | INT | DEFAULT 0 | 输入 Token |
| `tokens_output` | INT | DEFAULT 0 | 输出 Token |
| `passed` | BOOLEAN | DEFAULT FALSE | 是否通过 |
| `error_message` | TEXT | NULL | 错误信息 |
| `created_at` | TIMESTAMP | DEFAULT NOW | 创建时间 |

---

### 3.10 traces（调用追踪表）

记录所有 AI 模型调用。

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| `id` | UUID/VARCHAR(36) | PK | 主键 |
| `user_id` | UUID/VARCHAR(36) | NOT NULL | 用户 ID |
| `prompt_id` | UUID/VARCHAR(36) | FK, NULL | 关联 Prompt |
| `model_id` | UUID/VARCHAR(36) | FK, NULL | 使用的模型 |
| `input` | TEXT | NOT NULL | 输入内容 |
| `output` | TEXT | NULL | 输出内容 |
| `thinking_content` | TEXT | NULL | 思考/推理内容 🆕 |
| `thinking_time_ms` | INT UNSIGNED | NULL | 思考耗时（毫秒）🆕 |
| `tokens_input` | INT | DEFAULT 0 | 输入 Token |
| `tokens_output` | INT | DEFAULT 0 | 输出 Token |
| `latency_ms` | INT | DEFAULT 0 | 响应延迟(ms) |
| `status` | ENUM | DEFAULT 'success' | 状态：success/error |
| `error_message` | TEXT | NULL | 错误信息 |
| `metadata` | JSON | DEFAULT {} | 元数据 |
| `attachments` | JSON | DEFAULT [] | 附件 |
| `created_at` | TIMESTAMP | DEFAULT NOW | 创建时间 |

**TypeScript 类型：**
```typescript
type TraceStatus = 'success' | 'error';

interface Trace {
  id: string;
  user_id: string;
  prompt_id: string | null;
  model_id: string | null;
  input: string;
  output: string;
  thinking_content: string | null;  // 🆕 方案 A 新增
  thinking_time_ms: number | null;  // 🆕 方案 A 新增
  tokens_input: number;
  tokens_output: number;
  latency_ms: number;
  status: TraceStatus;
  error_message: string | null;
  metadata: Record<string, unknown>;
  attachments?: FileAttachmentData[] | null;
  created_at: string;
}
```

---

### 3.11 schema_migrations（迁移记录表）

记录数据库迁移版本。

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| `version` | INT | PK | 迁移版本号 |
| `name` | VARCHAR(255) | NOT NULL | 迁移名称 |
| `executed_at` | TIMESTAMP | DEFAULT NOW | 执行时间 |

---

## 4. JSON 字段结构

### 4.1 PromptVariable（变量定义）

```typescript
interface PromptVariable {
  name: string;                    // 变量名
  type: 'string' | 'number' | 'boolean' | 'array' | 'object';
  description?: string;            // 描述
  default_value?: string;          // 默认值
  required?: boolean;              // 是否必填
}

// 示例
[
  { "name": "topic", "type": "string", "description": "主题", "required": true },
  { "name": "count", "type": "number", "default_value": "5" }
]
```

### 4.2 PromptMessage（消息）

```typescript
interface PromptMessage {
  id: string;                      // 消息 ID
  role: 'system' | 'user' | 'assistant';
  content: string;                 // 消息内容
}

// 示例
[
  { "id": "1", "role": "system", "content": "你是一个有帮助的助手" },
  { "id": "2", "role": "user", "content": "请解释 {{topic}}" }
]
```

### 4.3 PromptConfig（模型参数）

```typescript
interface PromptConfig {
  temperature: number;             // 温度 (0-2)
  top_p: number;                   // Top P (0-1)
  frequency_penalty: number;       // 频率惩罚 (-2 到 2)
  presence_penalty: number;        // 存在惩罚 (-2 到 2)
  max_tokens: number;              // 最大输出 Token
  output_schema?: OutputSchema;    // 结构化输出
}

// 默认值
{
  "temperature": 1,
  "top_p": 0.7,
  "frequency_penalty": 0,
  "presence_penalty": 0,
  "max_tokens": 4096
}
```

### 4.4 OutputSchema（结构化输出）

```typescript
interface OutputSchema {
  enabled: boolean;                // 是否启用
  name: string;                    // Schema 名称
  strict: boolean;                 // 严格模式
  fields: SchemaField[];           // 字段定义
}

interface SchemaField {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'array' | 'object';
  description?: string;
  required: boolean;
  enum?: string[];                 // 枚举值
  items?: SchemaField;             // 数组元素类型
  properties?: SchemaField[];      // 对象属性
}
```

### 4.5 FileAttachmentData（文件附件）

```typescript
interface FileAttachmentData {
  name: string;                    // 文件名
  type: string;                    // MIME 类型
  base64: string;                  // Base64 编码内容
}

// 示例
[
  { "name": "image.png", "type": "image/png", "base64": "iVBORw0KGgo..." },
  { "name": "doc.pdf", "type": "application/pdf", "base64": "JVBERi0xLjQ..." }
]
```

### 4.6 EvaluationConfig（评测配置）

```typescript
interface EvaluationConfig {
  pass_threshold?: number;         // 通过阈值 (0-100)
}
```

### 4.7 EvaluationResults（评测结果）

```typescript
interface EvaluationResults {
  scores?: Record<string, number>; // 各标准平均分
  summary?: string;                // 总结
  total_cases?: number;            // 总用例数
  passed_cases?: number;           // 通过用例数
}
```

---

## 5. 索引设计

### 5.1 索引清单

| 表 | 索引名 | 字段 | 类型 |
|----|--------|------|------|
| providers | idx_providers_user_id | user_id | 普通索引 |
| models | idx_models_provider_id | provider_id | 普通索引 |
| prompts | idx_prompts_user_id | user_id | 普通索引 |
| prompt_versions | idx_prompt_versions_prompt_id | prompt_id | 普通索引 |
| evaluations | idx_evaluations_user_id | user_id | 普通索引 |
| test_cases | idx_test_cases_evaluation_id | evaluation_id | 普通索引 |
| test_cases | idx_test_cases_order | (evaluation_id, order_index) | 复合索引 |
| evaluation_criteria | idx_evaluation_criteria_evaluation_id | evaluation_id | 普通索引 |
| evaluation_runs | idx_evaluation_runs_evaluation_id | evaluation_id | 普通索引 |
| evaluation_runs | idx_evaluation_runs_status | status | 普通索引 |
| evaluation_runs | idx_evaluation_runs_created_at | created_at DESC | 排序索引 |
| test_case_results | idx_test_case_results_evaluation_id | evaluation_id | 普通索引 |
| test_case_results | idx_test_case_results_test_case_id | test_case_id | 普通索引 |
| test_case_results | idx_test_case_results_run_id | run_id | 普通索引 |
| traces | idx_traces_user_id | user_id | 普通索引 |
| traces | idx_traces_created_at | created_at DESC | 排序索引 |

### 5.2 外键约束

| 子表 | 外键字段 | 父表 | 删除行为 |
|------|----------|------|----------|
| models | provider_id | providers | CASCADE |
| prompts | default_model_id | models | SET NULL |
| prompt_versions | prompt_id | prompts | CASCADE |
| evaluations | prompt_id | prompts | SET NULL |
| evaluations | model_id | models | SET NULL |
| evaluations | judge_model_id | models | SET NULL |
| test_cases | evaluation_id | evaluations | CASCADE |
| evaluation_criteria | evaluation_id | evaluations | CASCADE |
| evaluation_runs | evaluation_id | evaluations | CASCADE |
| test_case_results | evaluation_id | evaluations | CASCADE |
| test_case_results | test_case_id | test_cases | CASCADE |
| test_case_results | run_id | evaluation_runs | CASCADE |
| traces | prompt_id | prompts | SET NULL |
| traces | model_id | models | SET NULL |

---

## 6. 数据库差异

### 6.1 MySQL vs PostgreSQL

| 特性 | MySQL | PostgreSQL (Supabase) |
|------|-------|----------------------|
| UUID 生成 | `DEFAULT (UUID())` | `DEFAULT gen_random_uuid()` |
| 时间戳 | `TIMESTAMP` | `TIMESTAMPTZ` |
| 数组类型 | JSON | TEXT[] 或 JSONB |
| JSON 类型 | JSON | JSONB |
| 自动更新时间 | `ON UPDATE CURRENT_TIMESTAMP` | 需要触发器 |
| 枚举类型 | `ENUM(...)` | `CHECK (... IN (...))` |
| 字符集 | `utf8mb4_unicode_ci` | 默认 UTF-8 |

### 6.2 Supabase 特有配置

```sql
-- 行级安全策略 (RLS)
ALTER TABLE providers ENABLE ROW LEVEL SECURITY;

-- 访问策略
CREATE POLICY "Allow all access to providers"
  ON providers FOR ALL
  TO anon, authenticated
  USING (true) WITH CHECK (true);
```

---

## 附录

### A. 迁移文件位置

```
src/lib/database/migrations/
├── index.ts                           # 迁移注册
├── 001_initial.ts                     # 初始表结构
├── 002_add_traces_attachments.ts      # traces 添加 attachments
├── 003_add_model_vision_support.ts    # models 添加 vision 支持
└── 004_add_reasoning_support.ts       # 🆕 方案 A: 添加推理功能支持
```

### B. Schema 文件位置

| 用途 | 文件路径 |
|------|----------|
| MySQL Schema | `server/src/utils/schema.ts` |
| Supabase Schema | `src/lib/database/supabase-init-sql.ts` |
| Edge Function Schema | `supabase/functions/mysql-proxy/index.ts` |
| TypeScript 类型 | `src/types/database.ts` |

---

*文档日期: 2025-12-25*
*方案 A 更新: 2025-12-26*

---

## 7. 方案 A 变更说明

### 7.1 变更概览

| 表 | 变更类型 | 变更内容 |
|----|----------|----------|
| `providers` | 类型扩展 | `type` 枚举新增 `openrouter` |
| `models` | 新增字段 | `supports_reasoning`, `supports_function_calling` |
| `traces` | 新增字段 | `thinking_content`, `thinking_time_ms` |

### 7.2 迁移文件

**文件**: `src/lib/database/migrations/004_add_reasoning_support.ts`

```typescript
export const migration = {
  version: 4,
  name: 'add_reasoning_support',
  description: '添加推理/思考功能支持',

  mysql: `
    -- 1. 扩展 providers.type 枚举（MySQL 需要重建列）
    ALTER TABLE providers
    MODIFY COLUMN type ENUM('openai', 'anthropic', 'gemini', 'azure', 'custom', 'openrouter')
    NOT NULL DEFAULT 'openai';

    -- 2. models 表添加推理和工具调用支持字段
    SET @col1_exists = (
      SELECT COUNT(*) FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'models'
      AND COLUMN_NAME = 'supports_reasoning'
    );
    SET @sql1 = IF(@col1_exists = 0,
      'ALTER TABLE models ADD COLUMN supports_reasoning BOOLEAN DEFAULT FALSE',
      'SELECT 1'
    );
    PREPARE stmt1 FROM @sql1;
    EXECUTE stmt1;
    DEALLOCATE PREPARE stmt1;

    SET @col2_exists = (
      SELECT COUNT(*) FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'models'
      AND COLUMN_NAME = 'supports_function_calling'
    );
    SET @sql2 = IF(@col2_exists = 0,
      'ALTER TABLE models ADD COLUMN supports_function_calling BOOLEAN DEFAULT FALSE',
      'SELECT 1'
    );
    PREPARE stmt2 FROM @sql2;
    EXECUTE stmt2;
    DEALLOCATE PREPARE stmt2;

    -- 3. traces 表添加思考内容字段
    SET @col3_exists = (
      SELECT COUNT(*) FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'traces'
      AND COLUMN_NAME = 'thinking_content'
    );
    SET @sql3 = IF(@col3_exists = 0,
      'ALTER TABLE traces ADD COLUMN thinking_content TEXT',
      'SELECT 1'
    );
    PREPARE stmt3 FROM @sql3;
    EXECUTE stmt3;
    DEALLOCATE PREPARE stmt3;

    SET @col4_exists = (
      SELECT COUNT(*) FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'traces'
      AND COLUMN_NAME = 'thinking_time_ms'
    );
    SET @sql4 = IF(@col4_exists = 0,
      'ALTER TABLE traces ADD COLUMN thinking_time_ms INT UNSIGNED',
      'SELECT 1'
    );
    PREPARE stmt4 FROM @sql4;
    EXECUTE stmt4;
    DEALLOCATE PREPARE stmt4;
  `,

  postgresql: `
    -- 1. 扩展 providers.type 检查约束
    ALTER TABLE providers DROP CONSTRAINT IF EXISTS providers_type_check;
    ALTER TABLE providers ADD CONSTRAINT providers_type_check
      CHECK (type IN ('openai', 'anthropic', 'gemini', 'azure', 'custom', 'openrouter'));

    -- 2. models 表添加推理和工具调用支持字段
    ALTER TABLE models
    ADD COLUMN IF NOT EXISTS supports_reasoning BOOLEAN DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS supports_function_calling BOOLEAN DEFAULT FALSE;

    -- 3. traces 表添加思考内容字段
    ALTER TABLE traces
    ADD COLUMN IF NOT EXISTS thinking_content TEXT,
    ADD COLUMN IF NOT EXISTS thinking_time_ms INTEGER;
  `
};
```

### 7.3 TypeScript 类型更新

**文件**: `src/types/database.ts`

```typescript
// Provider 类型扩展
export type ProviderType =
  | 'openai'
  | 'anthropic'
  | 'gemini'
  | 'azure'
  | 'custom'
  | 'openrouter';  // 🆕 新增

// 推理强度类型
export type ReasoningEffort = 'default' | 'none' | 'low' | 'medium' | 'high';

// Model 接口更新
export interface Model {
  id: string;
  provider_id: string;
  model_id: string;
  name: string;
  capabilities: string[];
  supports_vision: boolean;
  supports_reasoning: boolean;        // 🆕 新增
  supports_function_calling: boolean; // 🆕 新增
  created_at: string;
}

// Trace 接口更新
export interface Trace {
  id: string;
  user_id: string;
  prompt_id: string | null;
  model_id: string | null;
  input: string;
  output: string;
  thinking_content: string | null;  // 🆕 新增
  thinking_time_ms: number | null;  // 🆕 新增
  tokens_input: number;
  tokens_output: number;
  latency_ms: number;
  status: 'success' | 'error';
  error_message: string | null;
  metadata: Record<string, unknown>;
  attachments?: FileAttachmentData[] | null;
  created_at: string;
}
```

### 7.4 Schema 文件更新清单

| 文件 | 更新内容 |
|------|----------|
| `server/src/utils/schema.ts` | MySQL 完整 schema 添加新字段 |
| `src/lib/database/supabase-init-sql.ts` | Supabase schema 添加新字段 |
| `supabase/functions/mysql-proxy/index.ts` | Edge Function schema 添加新字段 |
| `src/lib/database/migrations/index.ts` | 注册 004 迁移 |

### 7.5 字段用途说明

| 字段 | 表 | 用途 |
|------|-----|------|
| `supports_reasoning` | models | 标识模型是否支持思考/推理功能（如 o1、Claude 3.7+） |
| `supports_function_calling` | models | 标识模型是否支持工具/函数调用 |
| `thinking_content` | traces | 存储 AI 模型的思考过程内容 |
| `thinking_time_ms` | traces | 记录思考阶段耗时（毫秒） |

### 7.6 推理模型自动识别

新增模型时，系统会根据模型名称自动推断 `supports_reasoning`：

```typescript
const REASONING_MODEL_PATTERNS = [
  /^o1/,                    // OpenAI o1 系列
  /^o3/,                    // OpenAI o3 系列
  /^o4/,                    // OpenAI o4 系列
  /^gpt-5/,                 // GPT-5 系列
  /^claude-3\.[7-9]/,       // Claude 3.7+
  /^claude-.*-4/,           // Claude 4.x
  /^claude-.*-4\.[5-9]/,    // Claude 4.5+
  /gemini-.*-thinking/,     // Gemini Thinking
  /gemini-3/,               // Gemini 3
  /^qwq/,                   // Qwen QwQ
  /^qwen3/,                 // Qwen3
  /^deepseek-r/,            // DeepSeek R1
  /^deepseek-reasoner/,     // DeepSeek Reasoner
];
```

### 7.7 向后兼容性

- 所有新增字段都有默认值，不影响现有数据
- `supports_reasoning` 和 `supports_function_calling` 默认为 `FALSE`
- `thinking_content` 和 `thinking_time_ms` 默认为 `NULL`
- 现有代码无需修改即可正常运行

