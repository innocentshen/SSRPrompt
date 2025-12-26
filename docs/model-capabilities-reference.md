# AI 模型能力参考文档

> 基于 Cherry Studio 代码库研究整理，用于 SSRPrompt 项目参考

---

## 目录

1. [思考/推理功能](#1-思考推理功能)
2. [模型能力类型](#2-模型能力类型)
3. [各服务商模型详情](#3-各服务商模型详情)
4. [API 参数传递方式](#4-api-参数传递方式)
5. [思考内容处理机制](#5-思考内容处理机制)
6. [多模态/文件处理](#6-多模态文件处理)
7. [UI 交互设计](#7-ui-交互设计)

---

## 1. 思考/推理功能

### 1.1 推理强度等级

Cherry Studio 定义了以下推理强度等级：

| 等级 | 中文名称 | 比例系数 | 说明 |
|------|----------|----------|------|
| `default` | 默认 | 0 | 依赖模型默认行为，不作任何配置 |
| `none` | 关闭 | 0.01 | 禁用推理 |
| `minimal` | 最小 | 0.05 | 最低强度推理 |
| `low` | 浮想 | 0.05 | 低强度推理 |
| `medium` | 斟酌 | 0.5 | 中强度推理 |
| `high` | 沉思 | 0.8 | 高强度推理 |
| `xhigh` | 深度 | 0.9 | 超高强度推理（仅部分模型支持）|
| `auto` | 自动 | 2 | 由模型自动决定 |

### 1.2 Token 预算计算公式

```
budgetTokens = (tokenLimit.max - tokenLimit.min) * effortRatio + tokenLimit.min
```

### 1.3 各模型支持的推理强度

#### OpenAI 系列

| 模型 | 支持的强度 |
|------|-----------|
| o1, o3, o4 | `low`, `medium`, `high` |
| GPT-5, GPT-5.1 | `low`, `medium`, `high` |
| GPT-5.2 | `none`, `low`, `medium`, `high`, `xhigh` |

#### Google Gemini 系列

| 模型 | 支持的强度 |
|------|-----------|
| Gemini 2.0 Flash Thinking | 原生思考模型，无需配置 |
| Gemini 3 Flash | `minimal`, `low`, `medium`, `high` |
| Gemini 3 Flash Lite | `minimal`, `low`, `medium`, `high`, `auto` |
| Gemini 3 Pro | `minimal`, `low`, `medium`, `high`, `auto` |

#### Anthropic Claude 系列

| 模型 | Thinking Token 范围 |
|------|---------------------|
| Claude Sonnet 3.7/4 | 1,024 - 64,000 |
| Claude Opus 4.1 | 1,024 - 32,000 |
| Claude Haiku/Sonnet/Opus 4.5 | 1,024 - 64,000 |

#### 国产模型

| 模型 | 支持的强度 |
|------|-----------|
| Qwen 系列 | `low`, `medium`, `high` |
| Qwen3 系列 | `low`, `medium`, `high` |
| DeepSeek R1 | 原生思考模型 |
| Doubao Pro | `auto`, `high` |
| Doubao Max/Lite | `minimal`, `low`, `medium`, `high` |

#### xAI 系列

| 模型 | 支持的强度 |
|------|-----------|
| Grok 3 | `low`, `high` |
| Grok 4 Fast | `auto` |

---

## 2. 模型能力类型

### 2.1 能力枚举

| 能力类型 | 说明 |
|----------|------|
| `text` | 文本生成 |
| `vision` | 视觉/图像理解 |
| `reasoning` | 推理/思考能力 |
| `function_calling` | 工具调用/函数调用 |
| `web_search` | 联网搜索 |
| `embedding` | 文本嵌入 |
| `rerank` | 重排序 |

### 2.2 支持视觉（Vision）的模型

#### OpenAI
- GPT-4 系列（除 gpt-4-32k）
- GPT-4o 系列
- o1, o3, o4 系列（除 mini 版本）
- GPT-5 系列

#### Anthropic
- Claude 3 全系列
- Claude Haiku/Sonnet/Opus 4.x

#### Google
- Gemini 1.5 及以上所有版本
- Gemini 2.x 全系列
- Gemini 3.x 全系列

#### 国产模型
- Qwen-VL, Qwen2-VL, Qwen2.5-VL, Qwen3-VL
- Qwen-Omni 系列
- DeepSeek-VL
- Kimi (moonshot-v1-vision)
- Doubao-seed
- GLM-4V

#### 开源模型
- LLaVA
- MiniCPM
- InternVL2
- Moondream

### 2.3 支持工具调用（Function Calling）的模型

#### 完全支持
- OpenAI: GPT-4, GPT-4o, GPT-4.5 及变体
- Claude: 全系列
- o1, o3, o4 变体（除 mini/preview）
- Gemini: 2.x 及以上

#### 国产模型支持
- Qwen, Qwen3
- Hunyuan (腾讯)
- DeepSeek 系列
- GLM-4, GLM-4.5, GLM-4.7 (智谱)
- Kimi-K2 (月之暗面)
- MiniMax-M2
- Doubao-seed 系列

#### 不支持
- o1-mini, o1-preview
- 图像生成模型（DALL-E, Imagen 等）
- 嵌入/重排序模型

### 2.4 原生思考模型（无需配置即启用思考）

| 服务商 | 模型 |
|--------|------|
| OpenAI | o1, o3, o4 系列 |
| Google | gemini-2.0-flash-thinking-exp |
| DeepSeek | deepseek-reasoner, DeepSeek-R1 |
| Qwen | qwq-32b-preview |

---

## 3. 各服务商模型详情

### 3.1 OpenAI

| 模型 | 上下文窗口 | 最大输出 | 视觉 | 工具 | 推理 |
|------|-----------|----------|------|------|------|
| gpt-4o | 128K | 16K | ✅ | ✅ | ❌ |
| gpt-4o-mini | 128K | 16K | ✅ | ✅ | ❌ |
| gpt-4-turbo | 128K | 4K | ✅ | ✅ | ❌ |
| o1 | 200K | 100K | ✅ | ✅ | ✅ |
| o1-mini | 128K | 65K | ❌ | ❌ | ✅ |
| o1-preview | 128K | 32K | ❌ | ❌ | ✅ |
| o3-mini | 200K | 100K | ❌ | ✅ | ✅ |
| gpt-5 | 256K | 32K | ✅ | ✅ | ✅ |
| gpt-5.2 | 256K | 64K | ✅ | ✅ | ✅ |

### 3.2 Anthropic Claude

| 模型 | 上下文窗口 | 最大输出 | 视觉 | 工具 | 思考 Token |
|------|-----------|----------|------|------|------------|
| claude-3-opus | 200K | 4K | ✅ | ✅ | - |
| claude-3-sonnet | 200K | 4K | ✅ | ✅ | - |
| claude-3-haiku | 200K | 4K | ✅ | ✅ | - |
| claude-3.5-sonnet | 200K | 8K | ✅ | ✅ | - |
| claude-3.7-sonnet | 200K | 8K | ✅ | ✅ | 1K-64K |
| claude-sonnet-4 | 200K | 16K | ✅ | ✅ | 1K-64K |
| claude-opus-4 | 200K | 16K | ✅ | ✅ | 1K-64K |
| claude-4.5-sonnet | 200K | 16K | ✅ | ✅ | 1K-64K |

### 3.3 Google Gemini

| 模型 | 上下文窗口 | 最大输出 | 视觉 | 工具 | 推理 |
|------|-----------|----------|------|------|------|
| gemini-1.5-flash | 1M | 8K | ✅ | ✅ | ❌ |
| gemini-1.5-pro | 2M | 8K | ✅ | ✅ | ❌ |
| gemini-2.0-flash | 1M | 8K | ✅ | ✅ | ❌ |
| gemini-2.0-flash-thinking | 1M | 8K | ✅ | ❌ | ✅ (原生) |
| gemini-3-flash | 1M | 8K | ✅ | ✅ | ✅ |
| gemini-3-pro | 2M | 8K | ✅ | ✅ | ✅ |

### 3.4 国产模型

#### Qwen (通义千问)

| 模型 | 上下文窗口 | 最大输出 | 视觉 | 工具 | 推理 |
|------|-----------|----------|------|------|------|
| qwen-turbo | 128K | 8K | ❌ | ✅ | ❌ |
| qwen-plus | 128K | 8K | ❌ | ✅ | ❌ |
| qwen-max | 128K | 8K | ❌ | ✅ | ❌ |
| qwen-vl-plus | 32K | 2K | ✅ | ❌ | ❌ |
| qwen-vl-max | 32K | 2K | ✅ | ❌ | ❌ |
| qwen3-turbo | 128K | 8K | ❌ | ✅ | ✅ |
| qwen3-plus | 128K | 8K | ❌ | ✅ | ✅ |
| qwq-32b-preview | 32K | 8K | ❌ | ❌ | ✅ (原生) |

**Qwen 思考 Token 范围：**
- 标准版: 0 - 81,920
- Qwen3 非 Max 版: 1,024 - 38,912

#### DeepSeek

| 模型 | 上下文窗口 | 最大输出 | 视觉 | 工具 | 推理 |
|------|-----------|----------|------|------|------|
| deepseek-chat | 64K | 8K | ❌ | ✅ | ❌ |
| deepseek-coder | 64K | 8K | ❌ | ✅ | ❌ |
| deepseek-reasoner | 64K | 8K | ❌ | ❌ | ✅ (原生) |
| DeepSeek-R1 | 64K | 8K | ❌ | ❌ | ✅ (原生) |
| deepseek-vl | 32K | 4K | ✅ | ❌ | ❌ |

#### 其他国产模型

| 模型 | 服务商 | 视觉 | 工具 | 推理 |
|------|--------|------|------|------|
| glm-4 | 智谱 | ❌ | ✅ | ❌ |
| glm-4v | 智谱 | ✅ | ❌ | ❌ |
| glm-4.5 | 智谱 | ❌ | ✅ | ❌ |
| hunyuan-pro | 腾讯 | ❌ | ✅ | ❌ |
| moonshot-v1 | 月之暗面 | ❌ | ✅ | ❌ |
| moonshot-v1-vision | 月之暗面 | ✅ | ❌ | ❌ |
| kimi-k2 | 月之暗面 | ❌ | ✅ | ❌ |
| doubao-pro | 字节 | ❌ | ❌ | ✅ |
| doubao-seed | 字节 | ✅ | ✅ | ❌ |

---

## 4. API 参数传递方式

### 4.1 OpenAI / OpenRouter

```typescript
// 请求体
{
  model: "o1",
  messages: [...],
  reasoning_effort: "low" | "medium" | "high"
}

// 流式响应中的思考字段
{
  choices: [{
    delta: {
      content: "正式回复内容",
      reasoning: "思考内容",           // OpenRouter
      reasoning_content: "思考内容"    // 某些模型
    },
    message: {
      reasoning_details: [             // 非流式部分
        { type: "reasoning.text", text: "..." }
      ]
    }
  }]
}
```

### 4.2 Anthropic Claude

```typescript
// 请求体 - 启用思考
{
  model: "claude-3.7-sonnet",
  messages: [...],
  thinking: {
    type: "enabled",
    budget_tokens: 4096  // 根据强度计算
  }
}

// 请求体 - 禁用思考
{
  thinking: {
    type: "disabled"
  }
}

// 请求头
{
  "anthropic-beta": "interleaved-thinking-2025-05-14"
}

// 流式响应
// event: content_block_start
{
  type: "content_block_start",
  content_block: {
    type: "thinking",
    thinking: "思考内容..."
  }
}

// event: content_block_delta
{
  type: "content_block_delta",
  delta: {
    type: "thinking_delta",
    thinking: "增量思考内容..."
  }
}
```

### 4.3 Google Gemini

```typescript
// 方式一：使用 token 预算
{
  contents: [...],
  generationConfig: {
    thinkingConfig: {
      thinkingBudget: 4096  // token 数量
    }
  }
}

// 方式二：使用等级
{
  contents: [...],
  generationConfig: {
    thinkingConfig: {
      thinkingLevel: "MINIMAL" | "LOW" | "MEDIUM" | "HIGH"
    }
  }
}
```

### 4.4 Qwen (通义千问)

```typescript
// 方式一：原生 API
{
  model: "qwen3-turbo",
  messages: [...],
  enable_thinking: true,
  reasoning_effort: "low" | "medium" | "high"
}

// 方式二：通过 Ollama 等不支持原生参数的 provider
// 在用户消息末尾添加后缀
{
  messages: [
    {
      role: "user",
      content: "你的问题 /think"   // 启用思考
      // 或
      content: "你的问题 /no_think" // 禁用思考
    }
  ]
}
```

### 4.5 DeepSeek

```typescript
// DeepSeek R1 使用混合推理模式
{
  model: "deepseek-reasoner",
  messages: [...],
  reasoning_effort: "low" | "medium" | "high"
}

// 响应中使用 <think> 标签
// content: "<think>思考过程...</think>正式回复内容"
```

### 4.6 NewAPI / OneAPI (OpenAI 兼容网关)

NewAPI 和 OneAPI 是 LLM API 管理和分发系统，作为统一网关转发请求到各个实际的模型服务商。

#### 什么是 NewAPI

- **定位**：下一代 AI 网关和资产管理系统
- **功能**：统一管理多个 AI 服务商的 API，提供负载均衡、计费、限流等功能
- **协议**：支持 OpenAI、Anthropic Claude、Google Gemini 等多种协议
- **部署**：可自建部署，默认地址 `http://localhost:3000`

#### Cherry Studio 中的处理方式

在 Cherry Studio 中，NewAPI 作为一种独立的 provider 类型（`new-api`）：

```typescript
// Provider 配置
{
  id: 'new-api',
  name: 'New API',
  type: 'new-api',
  apiKey: 'your-token',
  apiHost: 'http://localhost:3000',      // OpenAI 兼容端点
  anthropicApiHost: 'http://localhost:3000', // Claude 端点（如需）
  models: [...],
  enabled: true
}
```

#### 思考/推理参数处理

由于 NewAPI 是转发网关，思考参数的传递取决于：

1. **后端实际服务商**：NewAPI 会将请求转发给实际的模型服务商
2. **模型类型识别**：根据模型名称判断应该使用哪种参数格式

```typescript
// 通用处理逻辑
function getReasoningParams(provider, model, effort) {
  // NewAPI/OneAPI 使用 OpenAI 兼容格式
  if (provider.type === 'new-api' || provider.type === 'one-api') {
    // 根据模型名称判断实际服务商
    if (isClaudeModel(model)) {
      // Claude 模型：转换为 thinking 参数
      return {
        thinking: {
          type: effort === 'none' ? 'disabled' : 'enabled',
          budget_tokens: calculateBudget(effort)
        }
      }
    } else if (isGeminiModel(model)) {
      // Gemini 模型：转换为 thinkingConfig
      return {
        extra_body: {
          generationConfig: {
            thinkingConfig: {
              thinkingBudget: calculateBudget(effort)
            }
          }
        }
      }
    } else if (isOpenAIReasoningModel(model)) {
      // OpenAI o系列：使用 reasoning_effort
      return {
        reasoning_effort: effort
      }
    } else if (isQwenModel(model)) {
      // Qwen 模型
      return {
        enable_thinking: effort !== 'none',
        reasoning_effort: effort
      }
    }

    // 默认：OpenAI 兼容格式
    return {
      reasoning_effort: effort
    }
  }
}
```

#### 模型名称识别规则

```typescript
// Cherry Studio 的模型识别逻辑
const MODEL_PATTERNS = {
  claude: /^claude-|^anthropic\//,
  gemini: /^gemini-|^google\//,
  openai_reasoning: /^o1|^o3|^o4|^gpt-5/,
  qwen: /^qwen|^qwq/,
  deepseek: /^deepseek/,
}

function detectModelProvider(modelName: string) {
  if (MODEL_PATTERNS.claude.test(modelName)) return 'anthropic'
  if (MODEL_PATTERNS.gemini.test(modelName)) return 'gemini'
  if (MODEL_PATTERNS.openai_reasoning.test(modelName)) return 'openai_reasoning'
  if (MODEL_PATTERNS.qwen.test(modelName)) return 'qwen'
  if (MODEL_PATTERNS.deepseek.test(modelName)) return 'deepseek'
  return 'openai' // 默认
}
```

#### 响应中思考内容的提取

由于 NewAPI 只是转发，响应格式取决于实际服务商：

```typescript
// 统一的响应处理
function extractThinking(response, modelName) {
  const provider = detectModelProvider(modelName)

  switch (provider) {
    case 'anthropic':
      // Claude 格式：thinking 字段
      return response.thinking || extractFromBlocks(response)

    case 'openai_reasoning':
      // OpenAI 格式：reasoning_content 或 reasoning_details
      return response.reasoning_content ||
             extractFromReasoningDetails(response.reasoning_details)

    case 'qwen':
    case 'deepseek':
      // 标签格式：<think>...</think>
      return extractFromTags(response.content)

    default:
      // 尝试所有格式
      return response.reasoning ||
             response.reasoning_content ||
             extractFromTags(response.content)
  }
}
```

#### 配置建议

| 场景 | 推荐配置 |
|------|----------|
| 自建 NewAPI | Provider Type: `new-api`，按实际地址配置 |
| 使用第三方转发服务 | Provider Type: `openai`，配置对应 Base URL |
| 需要 Claude 协议 | 额外配置 `anthropicApiHost` |
| 需要 Gemini 协议 | 当前需要自定义处理（[Issue #11531](https://github.com/CherryHQ/cherry-studio/issues/11531)）|

#### 已知限制

1. **Gemini 协议支持有限**：NewAPI 暂不支持独立的 Gemini 协议地址配置
2. **思考签名问题**：Gemini 3 通过 OpenRouter/NewAPI 使用工具时可能出现 `missing thought_signature` 错误
3. **参数兼容性**：某些参数可能不被所有转发服务支持

### 4.7 OpenRouter (统一推理参数)

OpenRouter 提供了统一的 `reasoning` 参数格式，适用于多种模型：

```typescript
// OpenRouter 统一推理参数
{
  model: "anthropic/claude-3.7-sonnet",
  messages: [...],
  reasoning: {
    enabled: true,
    effort: "medium",        // 'low' | 'medium' | 'high'
    max_tokens: 4096         // 可选：直接指定 token 数量
  }
}

// 禁用推理
{
  reasoning: {
    enabled: false
  }
}
```

**支持的模型**：
- Claude 3.7 Sonnet 及以上
- OpenAI o1/o3/o4 系列
- Qwen 思考模型
- DeepSeek R1

---

## 5. 思考内容处理机制

### 5.1 思考内容提取模式

Cherry Studio 支持多种思考内容的提取模式：

```typescript
// 1. 原生字段提取
delta.reasoning          // OpenRouter
delta.reasoning_content  // 某些 OpenAI 兼容模型

// 2. XML 标签提取
/<think>([\s\S]*?)<\/think>/gi
/<thinking>([\s\S]*?)<\/thinking>/gi
/<thought>([\s\S]*?)<\/thought>/gi
/<reasoning>([\s\S]*?)<\/reasoning>/gi

// 3. 特殊格式
/\[THINKING\]([\s\S]*?)\[\/THINKING\]/gi
/◁think▷([\s\S]*?)◁\/think▷/gi
/<seed:think>([\s\S]*?)<\/seed:think>/gi

// 4. Markdown 格式
/###\s*Thinking\s*\n([\s\S]*?)(?=###\s*Response|$)/gi
```

### 5.2 统一的 Chunk 类型系统

```typescript
enum ChunkType {
  // 思考相关
  THINKING_CONTENT_START = 'THINKING_CONTENT_START',
  THINKING_CONTENT_DELTA = 'THINKING_CONTENT_DELTA',
  THINKING_CONTENT_COMPLETE = 'THINKING_CONTENT_COMPLETE',

  // 文本内容
  TEXT_CONTENT_START = 'TEXT_CONTENT_START',
  TEXT_CONTENT_DELTA = 'TEXT_CONTENT_DELTA',
  TEXT_CONTENT_COMPLETE = 'TEXT_CONTENT_COMPLETE',

  // 工具调用
  TOOL_CALL_START = 'TOOL_CALL_START',
  TOOL_CALL_DELTA = 'TOOL_CALL_DELTA',
  TOOL_CALL_COMPLETE = 'TOOL_CALL_COMPLETE',

  // ... 40+ 种类型
}
```

### 5.3 消息块架构

```typescript
// 消息块类型
enum MessageBlockType {
  MAIN_TEXT = 'MAIN_TEXT',    // 主要文本
  THINKING = 'THINKING',       // 思考内容
  CODE = 'CODE',               // 代码块
  IMAGE = 'IMAGE',             // 图片
  TOOL = 'TOOL',               // 工具调用
  CITATION = 'CITATION',       // 引用
}

// 思考块结构
interface ThinkingMessageBlock {
  id: string
  type: MessageBlockType.THINKING
  content: string              // 思考内容
  thinking_millsec?: number    // 思考耗时（毫秒）
  status: 'streaming' | 'success' | 'error'
}

// 消息结构
interface Message {
  id: string
  role: 'user' | 'assistant'
  blocks: string[]  // 块 ID 引用数组
  // ...
}
```

### 5.4 流式处理回调

```typescript
interface ThinkingCallbacks {
  onThinkingStart: () => void
  onThinkingChunk: (chunk: { content: string }) => void
  onThinkingComplete: (totalTimeMs: number) => void
}

// 使用示例
const callbacks = {
  onThinkingStart: () => {
    // 创建思考块，状态设为 streaming
    createThinkingBlock({ status: 'streaming' })
  },

  onThinkingChunk: (chunk) => {
    // 追加思考内容
    appendToThinkingBlock(chunk.content)
  },

  onThinkingComplete: (timeMs) => {
    // 完成思考块，记录耗时
    finalizeThinkingBlock({
      status: 'success',
      thinking_millsec: timeMs
    })
  }
}
```

---

## 6. 多模态/文件处理

### 6.1 文件类型支持矩阵

| 文件类型 | OpenAI | Anthropic | Gemini | Azure | 自定义 |
|----------|--------|-----------|--------|-------|--------|
| 图片 (jpg/png/gif/webp) | ✅ | ✅ | ✅ | ✅ | 取决于后端 |
| PDF | ✅ (需转换) | ✅ (原生) | ✅ (原生) | ✅ | 取决于后端 |
| Word (.docx) | ❌ | ❌ | ✅ | ❌ | 文本提取 |
| Excel (.xlsx) | ❌ | ❌ | ✅ | ❌ | 文本提取 |
| 文本 (.txt/.md/.json) | ✅ | ✅ | ✅ | ✅ | ✅ |

### 6.2 文件大小限制

| 服务商 | 图片限制 | PDF 限制 | 其他文件 |
|--------|----------|----------|----------|
| OpenAI | 20MB | 需转图片 | - |
| Anthropic | 5MB/张 | 32MB | - |
| Gemini | 20MB (内联) | 20MB (内联) | 2GB (File API) |
| Azure | 20MB | 需转图片 | - |

### 6.3 各服务商 API 格式

#### 6.3.1 OpenAI 图片格式

```typescript
// OpenAI - 使用 image_url 类型
{
  model: "gpt-4o",
  messages: [
    {
      role: "user",
      content: [
        {
          type: "text",
          text: "描述这张图片"
        },
        {
          type: "image_url",
          image_url: {
            url: "data:image/jpeg;base64,/9j/4AAQSkZJRg...",
            detail: "auto"  // 'low' | 'high' | 'auto'
          }
        }
      ]
    }
  ]
}

// OpenAI - 也支持 URL 引用
{
  type: "image_url",
  image_url: {
    url: "https://example.com/image.jpg"
  }
}
```

#### 6.3.2 OpenAI PDF 格式（新版 API）

```typescript
// OpenAI 新版 API 支持 file 类型
{
  model: "gpt-4o",
  messages: [
    {
      role: "user",
      content: [
        {
          type: "text",
          text: "总结这个 PDF 文档"
        },
        {
          type: "file",
          file: {
            filename: "document.pdf",
            file_data: "data:application/pdf;base64,JVBERi0xLjQK..."
          }
        }
      ]
    }
  ]
}
```

#### 6.3.3 Anthropic Claude 格式

```typescript
// Anthropic - 图片使用 image 类型 + source
{
  model: "claude-3-5-sonnet-20241022",
  messages: [
    {
      role: "user",
      content: [
        {
          type: "image",
          source: {
            type: "base64",
            media_type: "image/jpeg",  // 注意：必须是 image/jpeg，不能是 image/jpg
            data: "/9j/4AAQSkZJRg..."  // 纯 base64，不含 data: 前缀
          }
        },
        {
          type: "text",
          text: "描述这张图片"
        }
      ]
    }
  ]
}

// Anthropic - PDF 使用 document 类型
{
  role: "user",
  content: [
    {
      type: "document",
      source: {
        type: "base64",
        media_type: "application/pdf",
        data: "JVBERi0xLjQK..."
      }
    },
    {
      type: "text",
      text: "总结这个文档"
    }
  ]
}

// 请求头（PDF 需要 beta 标识）
headers: {
  "x-api-key": "sk-xxx",
  "anthropic-version": "2023-06-01",
  "anthropic-beta": "pdfs-2024-09-25"
}
```

#### 6.3.4 Google Gemini 格式

```typescript
// Gemini - 小文件使用 inlineData
{
  contents: [
    {
      role: "user",
      parts: [
        {
          inlineData: {
            mimeType: "image/jpeg",
            data: "/9j/4AAQSkZJRg..."  // 纯 base64
          }
        },
        {
          text: "描述这张图片"
        }
      ]
    }
  ]
}

// Gemini - 大文件使用 File API 上传后引用
{
  contents: [
    {
      role: "user",
      parts: [
        {
          fileData: {
            mimeType: "application/pdf",
            fileUri: "https://generativelanguage.googleapis.com/v1beta/files/abc123"
          }
        },
        {
          text: "总结这个文档"
        }
      ]
    }
  ]
}

// Gemini File API 上传流程
// 1. 上传文件
POST https://generativelanguage.googleapis.com/upload/v1beta/files?key=xxx
Content-Type: multipart/form-data
Body: { file: <binary>, metadata: { displayName: "xxx.pdf" } }

// 2. 等待处理完成
GET https://generativelanguage.googleapis.com/v1beta/files/{fileId}?key=xxx
// 返回 state: "ACTIVE" 后可使用
```

#### 6.3.5 统一处理示例（多服务商适配）

```typescript
// 统一的文件内容构建函数
function buildFileContent(
  file: { base64: string; type: string; name: string },
  providerType: ProviderType
): ContentPart {
  const isImage = file.type.startsWith('image/');
  const isPdf = file.type === 'application/pdf';

  switch (providerType) {
    case 'openai':
    case 'azure':
    case 'custom':
      if (isImage) {
        return {
          type: 'image_url',
          image_url: {
            url: `data:${file.type};base64,${file.base64}`
          }
        };
      }
      if (isPdf) {
        return {
          type: 'file',
          file: {
            filename: file.name,
            file_data: `data:application/pdf;base64,${file.base64}`
          }
        };
      }
      break;

    case 'anthropic':
      // 修正 MIME 类型
      const mediaType = file.type === 'image/jpg' ? 'image/jpeg' : file.type;

      if (isImage) {
        return {
          type: 'image',
          source: {
            type: 'base64',
            media_type: mediaType,
            data: file.base64
          }
        };
      }
      if (isPdf) {
        return {
          type: 'document',
          source: {
            type: 'base64',
            media_type: 'application/pdf',
            data: file.base64
          }
        };
      }
      break;

    case 'gemini':
      return {
        inlineData: {
          mimeType: file.type,
          data: file.base64
        }
      };
  }

  // 默认：作为文本附件
  return {
    type: 'text',
    text: `[附件: ${file.name}]`
  };
}
```

### 6.4 图片处理最佳实践

#### 6.4.1 图片压缩

```typescript
// Cherry Studio 的图片压缩策略
const COMPRESSION_OPTIONS = {
  maxSizeMB: 1,           // 最大 1MB
  maxWidthOrHeight: 300,  // 最大边长 300px（缩略图）
  useWebWorker: true,
  fileType: 'image/jpeg'
};

// 使用 browser-image-compression 库
import imageCompression from 'browser-image-compression';

async function compressImage(file: File): Promise<File> {
  if (file.size <= 1024 * 1024) {
    return file; // 小于 1MB 不压缩
  }
  return await imageCompression(file, COMPRESSION_OPTIONS);
}
```

#### 6.4.2 图片 detail 参数（OpenAI）

```typescript
// OpenAI 的 detail 参数影响 token 消耗和识别精度
{
  type: "image_url",
  image_url: {
    url: "data:image/jpeg;base64,...",
    detail: "low"   // 固定 85 tokens，快速预览
    // detail: "high"  // 根据图片大小计算，最高精度
    // detail: "auto"  // 模型自动选择
  }
}

// Token 计算规则 (high detail)
// 1. 图片缩放到 2048x2048 以内
// 2. 按 768x768 的 tile 计算
// 3. 每个 tile = 170 tokens
// 4. 基础 = 85 tokens
// 公式: 85 + 170 * tiles
```

### 6.5 PDF 处理策略

#### 6.5.1 优先级策略

```
1. 原生 PDF 支持（Anthropic, Gemini）
   ↓ 不支持
2. 转换为图片后发送（OpenAI）
   ↓ 文件过大
3. 文本提取后发送
```

#### 6.5.2 PDF 转图片

```typescript
// 使用 pdf.js 将 PDF 转换为图片
import * as pdfjsLib from 'pdfjs-dist';

async function pdfToImages(pdfData: ArrayBuffer): Promise<string[]> {
  const pdf = await pdfjsLib.getDocument({ data: pdfData }).promise;
  const images: string[] = [];

  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const viewport = page.getViewport({ scale: 2.0 });

    const canvas = document.createElement('canvas');
    canvas.width = viewport.width;
    canvas.height = viewport.height;

    await page.render({
      canvasContext: canvas.getContext('2d')!,
      viewport
    }).promise;

    images.push(canvas.toDataURL('image/jpeg', 0.8));
  }

  return images;
}
```

#### 6.5.3 PDF 文本提取

```typescript
// 使用 pdf-parse 提取文本
import pdf from 'pdf-parse';

async function extractPdfText(buffer: Buffer): Promise<string> {
  const data = await pdf(buffer);
  return data.text;
}
```

### 6.6 Office 文档处理

```typescript
// 使用 officeparser 提取 Office 文档内容
import officeParser from 'officeparser';

async function extractOfficeContent(buffer: Buffer): Promise<string> {
  return new Promise((resolve, reject) => {
    officeParser.parseOffice(buffer, (err, data) => {
      if (err) reject(err);
      else resolve(data);
    });
  });
}

// 支持的格式
// .docx, .pptx, .xlsx, .odt, .odp, .ods
```

### 6.7 视觉模型识别规则

```typescript
// Cherry Studio 的视觉模型识别模式
const VISION_MODEL_PATTERNS = [
  // OpenAI
  /gpt-4o/i,
  /gpt-4-turbo/i,
  /gpt-4-vision/i,
  /o1(?!-mini)/i,  // o1 支持，o1-mini 不支持
  /o3/i,
  /o4/i,

  // Anthropic
  /claude-3/i,
  /claude-.*-4/i,

  // Google
  /gemini/i,

  // 开源模型
  /llava/i,
  /cogvlm/i,
  /qwen.*vl/i,
  /internvl/i,
  /moondream/i,
  /minicpm/i,
];

// 明确排除的模型
const NON_VISION_PATTERNS = [
  /text-embedding/i,
  /whisper/i,
  /tts/i,
  /dall-e/i,
  /gpt-3/i,
  /o1-mini/i,
  /o3-mini/i,
];

function isVisionModel(modelId: string): boolean {
  const lower = modelId.toLowerCase();

  // 先检查排除列表
  if (NON_VISION_PATTERNS.some(p => p.test(lower))) {
    return false;
  }

  // 再检查支持列表
  return VISION_MODEL_PATTERNS.some(p => p.test(lower));
}
```

### 6.8 文件上传能力检测

```typescript
interface FileUploadCapabilities {
  canUploadImage: boolean;
  canUploadPdf: boolean;
  canUploadOffice: boolean;
  canUploadText: boolean;
  maxFileSize: number;        // bytes
  acceptedTypes: string[];    // MIME types
}

function getFileUploadCapabilities(
  providerType: ProviderType,
  modelId: string,
  supportsVision: boolean
): FileUploadCapabilities {
  const base: FileUploadCapabilities = {
    canUploadImage: false,
    canUploadPdf: false,
    canUploadOffice: false,
    canUploadText: true,       // 文本始终支持
    maxFileSize: 20 * 1024 * 1024,  // 默认 20MB
    acceptedTypes: ['.txt', '.md', '.json', '.csv', '.xml', '.yaml']
  };

  if (!supportsVision) {
    return base;
  }

  // 图片支持
  base.canUploadImage = true;
  base.acceptedTypes.push('image/*');

  // PDF 支持
  switch (providerType) {
    case 'anthropic':
      base.canUploadPdf = true;
      base.maxFileSize = 32 * 1024 * 1024;  // Claude 支持 32MB PDF
      break;
    case 'gemini':
      base.canUploadPdf = true;
      base.canUploadOffice = true;  // Gemini 支持 Office
      base.maxFileSize = 20 * 1024 * 1024;
      break;
    case 'openai':
    case 'azure':
      // 检查是否是支持 PDF 的模型
      if (/gpt-4o|o1|o3|o4/.test(modelId)) {
        base.canUploadPdf = true;
      }
      break;
    case 'custom':
      // 根据模型名称推断
      if (/claude|gemini/.test(modelId.toLowerCase())) {
        base.canUploadPdf = true;
      }
      break;
  }

  if (base.canUploadPdf) {
    base.acceptedTypes.push('application/pdf');
  }
  if (base.canUploadOffice) {
    base.acceptedTypes.push('.docx', '.xlsx', '.pptx');
  }

  return base;
}
```

---

## 7. UI 交互设计

### 7.1 推理强度选择器

```
┌─────────────────────────────────────────┐
│ ◉ 默认     依赖模型默认行为，不作任何配置  │
├─────────────────────────────────────────┤
│ ○ 关闭                       禁用推理 ✓ │
├─────────────────────────────────────────┤
│ ○ 浮想                     低强度推理   │
├─────────────────────────────────────────┤
│ ○ 斟酌                     中强度推理   │
├─────────────────────────────────────────┤
│ ○ 沉思                     高强度推理   │
└─────────────────────────────────────────┘
  思维链长度        ESC 关闭  ▲▼ 选择  ↵ 确认
```

### 7.2 思考内容显示组件

```
┌─────────────────────────────────────────┐
│ 💡 思考过程                    2.5s  ▼ │
├─────────────────────────────────────────┤
│ ┌─────────────────────────────────────┐ │
│ │ 首先，我需要分析这个问题...        │ │
│ │                                     │ │
│ │ 考虑到以下几个方面：               │ │
│ │ 1. 用户的实际需求                  │ │
│ │ 2. 技术实现的可行性                │ │
│ │ ...                                 │ │
│ └─────────────────────────────────────┘ │
└─────────────────────────────────────────┘

// 折叠状态
┌─────────────────────────────────────────┐
│ 💡 思考过程                    2.5s  ▶ │
└─────────────────────────────────────────┘
```

### 7.3 流式思考动画

- 思考进行中时，灯泡图标有脉冲动画
- 思考内容实时滚动显示（最新内容在底部）
- 使用渐变遮罩实现文本淡入效果
- 默认只显示最后 5 行，展开后显示全部

### 7.4 状态指示

| 状态 | 图标 | 说明 |
|------|------|------|
| 思考中 | 💡 (动画) | 正在进行推理 |
| 思考完成 | 💡 (静止) | 推理已完成 |
| 思考失败 | ⚠️ | 推理过程出错 |

---

## 附录

### A. 服务商 API 端点

| 服务商 | Base URL | 文档 |
|--------|----------|------|
| OpenAI | https://api.openai.com | https://platform.openai.com/docs |
| Anthropic | https://api.anthropic.com | https://docs.anthropic.com |
| Google | https://generativelanguage.googleapis.com | https://ai.google.dev/docs |
| OpenRouter | https://openrouter.ai/api | https://openrouter.ai/docs |
| DeepSeek | https://api.deepseek.com | https://platform.deepseek.com/api-docs |
| Qwen | https://dashscope.aliyuncs.com | https://help.aliyun.com/zh/model-studio |
| NewAPI | http://localhost:3000 (自建) | https://docs.newapi.pro |
| OneAPI | http://localhost:3000 (自建) | https://github.com/songquanpeng/one-api |

### B. 推荐的模型选择

#### 需要强推理能力
- OpenAI o1 / o3
- Claude 3.7 Sonnet / Claude Sonnet 4 (with thinking)
- DeepSeek R1
- Qwen QwQ

#### 平衡性能和成本
- GPT-4o-mini
- Claude 3.5 Haiku
- Gemini 2.0 Flash
- Qwen-turbo

#### 多模态任务
- GPT-4o
- Claude Sonnet 4
- Gemini 2.0 Flash
- Qwen-VL-Max

### C. 参考资源

- [Cherry Studio GitHub](https://github.com/CherryHQ/cherry-studio)
- [Cherry Studio NewAPI 配置文档](https://docs.cherry-ai.com/docs/en-us/pre-basic/providers/newapi)
- [Anthropic Extended Thinking](https://docs.anthropic.com/en/docs/build-with-claude/extended-thinking)
- [OpenAI Reasoning Models](https://platform.openai.com/docs/guides/reasoning)
- [Google Gemini Thinking](https://ai.google.dev/gemini-api/docs/thinking)
- [Qwen3 思考模式](https://qwenlm.github.io/blog/qwen3/)
- [OpenRouter Reasoning Tokens](https://openrouter.ai/docs/guides/best-practices/reasoning-tokens)
- [NewAPI 项目](https://github.com/Calcium-Ion/new-api)
- [OneAPI 项目](https://github.com/songquanpeng/one-api)

---

*文档整理日期: 2025-12-25*
*基于 Cherry Studio v1.7.x 代码库*
