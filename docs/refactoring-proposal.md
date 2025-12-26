# SSRPrompt 改造方案评估

> 目标：参考 Cherry Studio 的成熟方案，改造供应商配置和 AI 调用模块

---

## 1. 当前项目架构分析

### 1.1 供应商配置（现状）

**数据结构：**
```typescript
// src/types/database.ts
export type ProviderType = 'openai' | 'anthropic' | 'gemini' | 'azure' | 'custom';

export interface Provider {
  id: string;
  name: string;
  type: ProviderType;
  api_key: string;
  base_url: string | null;
  enabled: boolean;
}

export interface Model {
  id: string;
  provider_id: string;
  model_id: string;
  name: string;
  capabilities: string[];      // 未使用
  supports_vision: boolean;    // 唯一的能力配置
}
```

**特点：**
- ✅ 简洁的 5 种 provider 类型
- ✅ 支持多 API Key 轮询
- ❌ 模型能力只有 vision，缺少 reasoning、function_calling 等
- ❌ 没有思考/推理功能配置

### 1.2 AI 调用（现状）

**代码位置：** `src/lib/ai-service.ts`

**特点：**
- ✅ 支持 5 种 provider 的调用
- ✅ 支持流式响应
- ✅ 已有思考内容提取逻辑（被动提取 `<think>` 标签等）
- ❌ 没有主动配置推理参数（reasoning_effort、thinking 等）
- ❌ 没有针对不同模型的参数适配逻辑

### 1.3 模型能力推断（现状）

**代码位置：** `src/lib/model-capabilities.ts`

**特点：**
- ✅ 根据模型名称推断 vision 和 pdf 支持
- ❌ 缺少 reasoning、function_calling、web_search 等能力推断

---

## 2. 与 Cherry Studio 方案对比

| 维度 | SSRPrompt (现状) | Cherry Studio |
|------|-----------------|---------------|
| Provider 类型 | 5 种 | 12+ 种 |
| 模型能力 | 2 种 (vision, pdf) | 7+ 种 |
| 思考功能 | 被动提取 | 主动控制 + 强度选择 |
| 参数适配 | 硬编码分支 | 中间件 + 策略模式 |
| 状态管理 | 简单 useState | Entity Adapter |
| 消息结构 | 单一字符串 | 块架构 |

---

## 3. 改造方案（三种选择）

### 方案 A：轻量级增强（推荐）

**目标**：最小改动，添加思考功能核心能力

**改动范围**：
```
涉及文件数：约 10 个
预估工作量：2-3 天
```

**具体改动：**

#### 3.1 数据库层

```typescript
// src/types/database.ts - 新增字段

export type ProviderType =
  | 'openai'
  | 'anthropic'
  | 'gemini'
  | 'azure'
  | 'custom'
  | 'openrouter';  // 新增

export type ReasoningEffort = 'default' | 'none' | 'low' | 'medium' | 'high';

export interface Model {
  // ... 现有字段
  supports_vision: boolean;
  supports_reasoning: boolean;        // 新增
  supports_function_calling: boolean; // 新增
}

// Traces 表新增字段
export interface Trace {
  // ... 现有字段
  thinking_content?: string;    // 新增：思考内容
  thinking_time_ms?: number;    // 新增：思考耗时
}
```

**迁移文件：**
```typescript
// src/lib/database/migrations/004_add_reasoning_support.ts
export const migration = {
  version: 4,
  name: 'add_reasoning_support',
  mysql: `
    ALTER TABLE models
    ADD COLUMN supports_reasoning BOOLEAN DEFAULT FALSE,
    ADD COLUMN supports_function_calling BOOLEAN DEFAULT FALSE;

    ALTER TABLE traces
    ADD COLUMN thinking_content TEXT,
    ADD COLUMN thinking_time_ms INT UNSIGNED;
  `,
  postgresql: `/* 同上 */`
};
```

#### 3.2 AI 调用层

```typescript
// src/lib/ai-service.ts - 新增推理参数处理

export interface AICallOptions {
  responseFormat?: object;
  parameters?: ModelParameters;
  reasoning?: {
    enabled: boolean;
    effort: ReasoningEffort;
  };
}

// 在请求构建中添加推理参数
function buildRequestBody(provider, modelName, options) {
  const body = { /* 基础参数 */ };

  if (options?.reasoning?.enabled) {
    const effort = options.reasoning.effort;

    switch (provider.type) {
      case 'openai':
      case 'openrouter':
        if (isReasoningModel(modelName)) {
          body.reasoning_effort = effort;
        }
        break;

      case 'anthropic':
        if (supportsThinking(modelName)) {
          body.thinking = {
            type: 'enabled',
            budget_tokens: calculateBudget(effort)
          };
        }
        break;

      // ... 其他 provider
    }
  }

  return body;
}
```

#### 3.3 模型能力推断增强

```typescript
// src/lib/model-capabilities.ts - 新增推理能力推断

const REASONING_MODEL_PATTERNS = [
  /^o1/, /^o3/, /^o4/,           // OpenAI
  /^claude-3\.7/, /^claude-.*-4/, // Claude
  /gemini-.*-thinking/,           // Gemini
  /^qwq/, /^qwen3/,               // Qwen
  /^deepseek-r/, /^deepseek-reasoner/,
];

export function inferReasoningSupport(modelId: string): boolean {
  const lower = modelId.toLowerCase();
  return REASONING_MODEL_PATTERNS.some(p => p.test(lower));
}
```

#### 3.4 UI 层

```typescript
// 新增组件：src/components/Settings/ReasoningSelector.tsx
// 在 ProviderForm 中模型列表添加推理能力开关
// 在运行 Prompt 时添加推理强度选择器
```

**方案 A 改动清单：**

| 文件 | 改动类型 | 改动内容 |
|------|----------|----------|
| `src/types/database.ts` | 修改 | 新增类型和字段 |
| `src/lib/database/migrations/004_*.ts` | 新建 | 数据库迁移 |
| `src/lib/database/mysql-adapter.ts` | 修改 | 新增字段处理 |
| `server/src/utils/schema.ts` | 修改 | MySQL schema |
| `src/lib/database/supabase-init-sql.ts` | 修改 | Supabase schema |
| `src/lib/ai-service.ts` | 修改 | 添加推理参数 |
| `src/lib/model-capabilities.ts` | 修改 | 添加推理能力推断 |
| `src/components/Settings/ProviderForm.tsx` | 修改 | 添加能力开关 |
| `src/components/Prompt/ReasoningSelector.tsx` | 新建 | 推理选择器 |
| `src/pages/PromptWizardPage.tsx` | 修改 | 集成推理选择 |

---

### 方案 B：中等改造

**目标**：引入 Cherry Studio 的核心设计模式

**改动范围**：
```
涉及文件数：约 25 个
预估工作量：1-2 周
```

**新增内容：**

1. **参数构建器模式**
```typescript
// src/lib/ai-core/param-builder.ts
class AIParamBuilder {
  private provider: Provider;
  private model: Model;

  withReasoning(effort: ReasoningEffort): this { }
  withTools(tools: Tool[]): this { }
  build(): RequestParams { }
}
```

2. **响应处理器模式**
```typescript
// src/lib/ai-core/response-handler.ts
class StreamResponseHandler {
  onThinkingStart(): void { }
  onThinkingDelta(content: string): void { }
  onTextDelta(content: string): void { }
  onComplete(): void { }
}
```

3. **模型能力服务**
```typescript
// src/lib/ai-core/model-capabilities.ts
class ModelCapabilityService {
  getCapabilities(provider: Provider, modelId: string): ModelCapabilities;
  getSupportedReasoningEfforts(modelId: string): ReasoningEffort[];
  getThinkingTokenRange(modelId: string): { min: number; max: number };
}
```

4. **思考内容显示组件**
```typescript
// src/components/Common/ThinkingDisplay.tsx
function ThinkingDisplay({ content, timeMs, isStreaming }: Props) {
  const [expanded, setExpanded] = useState(false);
  // 可折叠的思考内容展示
}
```

---

### 方案 C：完整照搬

**目标**：完整采用 Cherry Studio 的架构

**改动范围**：
```
涉及文件数：50+ 个
预估工作量：3-4 周
```

**新增内容：**

1. **消息块架构**
2. **中间件系统**
3. **Entity Adapter 状态管理**
4. **完整的 Provider 配置系统**

**不推荐理由：**
- 当前项目规模不需要如此复杂的架构
- 改动过大，可能引入新问题
- Cherry Studio 是桌面应用，部分设计不适合 Web 应用

---

## 4. 推荐方案详细说明

### 推荐：方案 A（轻量级增强）

**理由：**
1. 改动最小，风险可控
2. 满足核心需求（思考功能配置）
3. 保持现有架构的简洁性
4. 可渐进式扩展

### 实施步骤

#### 第一阶段：数据库和类型

```bash
# 步骤 1: 更新类型定义
src/types/database.ts

# 步骤 2: 创建迁移文件
src/lib/database/migrations/004_add_reasoning_support.ts

# 步骤 3: 同步各处 schema
- server/src/utils/schema.ts
- src/lib/database/supabase-init-sql.ts
- supabase/functions/mysql-proxy/index.ts
```

#### 第二阶段：模型能力

```bash
# 步骤 4: 增强能力推断
src/lib/model-capabilities.ts

# 步骤 5: 更新 ProviderForm
src/components/Settings/ProviderForm.tsx
- 添加 supports_reasoning 开关
- 添加 supports_function_calling 开关
```

#### 第三阶段：AI 调用

```bash
# 步骤 6: 修改 AI 服务
src/lib/ai-service.ts
- 添加 reasoning 参数处理
- 添加各 provider 的参数适配

# 步骤 7: 增强流式响应处理
- 处理 Anthropic 的 thinking 响应
- 处理 OpenRouter 的 reasoning 响应
```

#### 第四阶段：UI 集成

```bash
# 步骤 8: 创建推理选择器
src/components/Common/ReasoningSelector.tsx

# 步骤 9: 创建思考显示组件
src/components/Common/ThinkingDisplay.tsx

# 步骤 10: 集成到 PromptWizardPage
src/pages/PromptWizardPage.tsx
```

---

## 5. 核心代码示例

### 5.1 推理参数构建

```typescript
// src/lib/ai-service.ts

const EFFORT_TO_BUDGET: Record<ReasoningEffort, number> = {
  default: 0,
  none: 0,
  low: 0.05,
  medium: 0.5,
  high: 0.8,
};

function calculateThinkingBudget(
  effort: ReasoningEffort,
  tokenRange: { min: number; max: number }
): number {
  const ratio = EFFORT_TO_BUDGET[effort];
  return Math.round(tokenRange.min + (tokenRange.max - tokenRange.min) * ratio);
}

function buildReasoningParams(
  provider: Provider,
  modelName: string,
  effort: ReasoningEffort
): Record<string, unknown> {
  if (effort === 'default' || effort === 'none') {
    return {};
  }

  switch (provider.type) {
    case 'openai':
    case 'custom':
      // 检测是否是推理模型
      if (/^o[134]|^gpt-5/.test(modelName)) {
        return { reasoning_effort: effort };
      }
      return {};

    case 'anthropic':
      // Claude 3.7+ 支持 thinking
      if (/claude-3\.[7-9]|claude-.*-4/.test(modelName)) {
        const budget = calculateThinkingBudget(effort, { min: 1024, max: 64000 });
        return {
          thinking: {
            type: 'enabled',
            budget_tokens: budget,
          },
        };
      }
      return {};

    case 'gemini':
      // Gemini 3 支持 thinkingConfig
      if (/gemini-3/.test(modelName)) {
        const budget = calculateThinkingBudget(effort, { min: 0, max: 24576 });
        return {
          generationConfig: {
            thinkingConfig: {
              thinkingBudget: budget,
            },
          },
        };
      }
      return {};

    case 'openrouter':
      // OpenRouter 统一格式
      return {
        reasoning: {
          enabled: true,
          effort: effort,
        },
      };

    default:
      return {};
  }
}
```

### 5.2 推理选择器组件

```typescript
// src/components/Common/ReasoningSelector.tsx

import { Brain } from 'lucide-react';

interface ReasoningSelectorProps {
  value: ReasoningEffort;
  onChange: (effort: ReasoningEffort) => void;
  modelId: string;
  disabled?: boolean;
}

const EFFORT_OPTIONS = [
  { value: 'default', label: '默认', description: '依赖模型默认行为' },
  { value: 'none', label: '关闭', description: '禁用推理' },
  { value: 'low', label: '浮想', description: '低强度推理' },
  { value: 'medium', label: '斟酌', description: '中强度推理' },
  { value: 'high', label: '沉思', description: '高强度推理' },
];

export function ReasoningSelector({
  value,
  onChange,
  modelId,
  disabled,
}: ReasoningSelectorProps) {
  const supportsReasoning = inferReasoningSupport(modelId);

  if (!supportsReasoning) {
    return null;
  }

  return (
    <div className="flex items-center gap-2">
      <Brain className="w-4 h-4 text-cyan-400" />
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as ReasoningEffort)}
        disabled={disabled}
        className="px-2 py-1 text-sm bg-slate-800 border border-slate-700 rounded"
      >
        {EFFORT_OPTIONS.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    </div>
  );
}
```

### 5.3 思考内容显示

```typescript
// src/components/Common/ThinkingDisplay.tsx

import { useState } from 'react';
import { Lightbulb, ChevronDown, ChevronRight } from 'lucide-react';

interface ThinkingDisplayProps {
  content: string;
  timeMs?: number;
  isStreaming?: boolean;
}

export function ThinkingDisplay({
  content,
  timeMs,
  isStreaming,
}: ThinkingDisplayProps) {
  const [expanded, setExpanded] = useState(false);

  if (!content) return null;

  return (
    <div className="mb-4 border border-slate-700 rounded-lg overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2 px-4 py-2 bg-slate-800/50 hover:bg-slate-800"
      >
        <Lightbulb
          className={`w-4 h-4 ${isStreaming ? 'text-yellow-400 animate-pulse' : 'text-slate-400'}`}
        />
        <span className="text-sm text-slate-300">思考过程</span>
        {timeMs && (
          <span className="text-xs text-slate-500">
            {(timeMs / 1000).toFixed(1)}s
          </span>
        )}
        <div className="flex-1" />
        {expanded ? (
          <ChevronDown className="w-4 h-4 text-slate-500" />
        ) : (
          <ChevronRight className="w-4 h-4 text-slate-500" />
        )}
      </button>

      {expanded && (
        <div className="px-4 py-3 bg-slate-900/50 text-sm text-slate-400 whitespace-pre-wrap max-h-60 overflow-y-auto">
          {content}
        </div>
      )}
    </div>
  );
}
```

---

## 6. 风险评估

| 风险点 | 影响程度 | 缓解措施 |
|--------|----------|----------|
| 数据库迁移失败 | 高 | 先备份，增量迁移，提供回滚脚本 |
| API 参数不兼容 | 中 | 添加 try-catch，优雅降级 |
| 思考内容解析失败 | 低 | 保持现有标签提取逻辑作为兜底 |
| 新 provider 类型测试不足 | 中 | 逐步添加，每种类型充分测试 |

---

## 7. 时间规划

| 阶段 | 内容 | 预估时间 |
|------|------|----------|
| 阶段 1 | 数据库和类型更新 | 0.5 天 |
| 阶段 2 | 模型能力增强 | 0.5 天 |
| 阶段 3 | AI 调用改造 | 1 天 |
| 阶段 4 | UI 组件开发 | 0.5 天 |
| 阶段 5 | 测试和调试 | 0.5 天 |
| **总计** | | **3 天** |

---

## 8. 结论

**推荐采用方案 A（轻量级增强）**

- 改动范围可控，约 10 个文件
- 满足思考功能的核心需求
- 预估 2-3 天完成
- 保持现有架构的简洁性
- 为未来扩展留有余地

后续如需更多能力（如工具调用、联网搜索等），可基于此方案渐进式扩展。

---

*评估日期: 2025-12-25*
