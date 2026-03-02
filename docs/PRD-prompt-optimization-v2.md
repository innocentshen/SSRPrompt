# PRD: Prompt 优化系统 v2.0

> 版本: 2.0 | 更新日期: 2026-03-02 | 状态: **已实现**

---

## 1. 背景与问题

当前 SSRPrompt 的 Prompt 优化功能存在四个核心短板：

### 1.1 解析不稳定

`prompt-analyzer.ts` 调用 `chatApi.complete` 时未传 `responseFormat`，靠正则 fallback 解析 JSON。模型返回格式不一致时，建议列表直接丢失（静默降级为空数组）。

### 1.2 建议无针对性

优化器只做静态文本分析，不参考评测系统已积累的真实运行结果（scores / aiFeedback / passed），导致建议泛泛而谈，无法针对实际失败用例给出改进方案。

### 1.3 应用不可靠

`smartReplace` 用滑动窗口做 markdown-stripped 模糊匹配。当模型返回的 `originalText` 与实际内容有细微差异时匹配失败，`replaced: false` 静默跳过，用户无感知。

### 1.4 无效果验证

建议 apply 后无自动验证机制，无法回答"这条建议到底有没有用"。

---

## 2. 目标

1. **可复现性** — 相同输入产生一致的结构化输出，消除解析失败
2. **有效性** — 基于真实评测数据给出针对性建议，而非通用规则
3. **可靠性** — 消除字符串匹配失败问题，失败时提供 diff 预览而非静默跳过
4. **可验证性** — 建议 apply 后可选测试用例跑 smoke test，用数据证明效果

---

## 3. 整体架构

分 4 个阶段交付，每阶段可独立上线。阶段 1 和 2 可并行开发。

```
阶段 1: 结构化输出 + Meta-Prompt 模板        → 解决"解析不稳定"
阶段 2: 评测数据聚合接口（按评测粒度）        → 解决"数据获取"前置依赖
阶段 3: 评测驱动的智能优化                    → 解决"建议无效"
阶段 4: 建议应用升级 + 验证用例面板 + Smoke Test → 解决"应用不可靠 + 无法验证"
```

### 设计决策

| 决策 | 说明 |
|------|------|
| 聚合粒度 = evaluationId | 同一 prompt 可关联多个评测（不同目标模型/Judge/标准），跨评测聚合无意义 |
| 前端选择评测 | 用户在优化面板中选择参考哪个评测，默认自动选中最近有 completed run 的评测 |
| 三级结构化输出降级 | `json_schema` → `json_object` → regex fallback，覆盖所有模型 |
| Smoke test 在前端执行 | 不创建正式 EvaluationRun 记录，仅做临时对比 |

---

## 4. 阶段 1: 结构化输出 + Meta-Prompt 模板

### 4.1 目标

消除优化分析的解析失败，将建议输出从"自由文本 + regex fallback"升级为"json_schema 强约束 + 三级降级"。

### 4.2 实现概述

#### 4.2.1 JSON Schema 定义

**文件**: `packages/shared/src/schemas/optimization.ts` (新建)

定义两个常量供 `responseFormat` 使用：

```typescript
export const OPTIMIZATION_RESULT_SCHEMA = {
  type: 'json_schema' as const,
  json_schema: {
    name: 'optimization_result',
    strict: true,
    schema: {
      type: 'object',
      required: ['score', 'summary', 'strengths', 'suggestions'],
      additionalProperties: false,
      properties: {
        score: { type: 'integer' },
        summary: { type: 'string' },
        strengths: { type: 'array', items: { type: 'string' } },
        suggestions: {
          type: 'array',
          items: {
            type: 'object',
            required: ['type', 'severity', 'title', 'description',
                       'messageIndex', 'originalText', 'suggestedText'],
            additionalProperties: false,
            properties: {
              type: { type: 'string', enum: ['clarity', 'structure', 'specificity', 'examples', 'constraints'] },
              severity: { type: 'string', enum: ['high', 'medium', 'low'] },
              title: { type: 'string' },
              description: { type: 'string' },
              messageIndex: { type: 'integer' },
              originalText: { type: 'string' },
              suggestedText: { type: 'string' },
            },
          },
        },
      },
    },
  },
};

export const OPTIMIZATION_RESULT_JSON_OBJECT_FORMAT = { type: 'json_object' as const };
```

#### 4.2.2 模型能力检测

**文件**: `packages/client/src/lib/model-capabilities.ts` (修改)

新增 `inferStructuredOutputSupport(modelId: string): StructuredOutputSupport`，沿用现有 `inferReasoningSupport` 的模式匹配风格：

| 级别 | 模型 | responseFormat |
|------|------|----------------|
| `json_schema` | gpt-4o, gpt-4-turbo, o1, o3, o4, gpt-5, gpt-oss, chatgpt-4o | `OPTIMIZATION_RESULT_SCHEMA` |
| `json_object` | gpt-3.5-turbo, gpt-4, claude, gemini, deepseek, qwen, qwq, glm, yi-, mistral, mixtral, command-r | `OPTIMIZATION_RESULT_JSON_OBJECT_FORMAT` |
| `none` | 其他 | 不传 responseFormat |

#### 4.2.3 prompt-analyzer.ts 核心改造

**文件**: `packages/client/src/lib/prompt-analyzer.ts` (重写)

**a) 消息标记改为 0-indexed**
```typescript
// Before: `[消息 ${i + 1} - ${m.role.toUpperCase()}]`
// After:  `[MSG-${i}] (${m.role.toUpperCase()})`
```

**b) 按模型能力传入 responseFormat**
```typescript
const structuredSupport = inferStructuredOutputSupport(modelId);
let responseFormat: object | undefined;
if (structuredSupport === 'json_schema') responseFormat = OPTIMIZATION_RESULT_SCHEMA;
else if (structuredSupport === 'json_object') responseFormat = OPTIMIZATION_RESULT_JSON_OBJECT_FORMAT;
```

**c) 三级解析管线**
- `json_schema` 模式 → `parseJsonResponse()`: 直接 `JSON.parse`，try-catch 兜底到 fallback
- `json_object` / `none` 模式 → `parseWithFallback()`: JSON.parse → code block 提取 → regex 提取 score/summary/strengths
- 最终兜底 → 返回 `{ score: 0, summary: '解析失败', strengths: [], suggestions: [] }`

**d) 预留评测数据入口** (阶段 3)
- `PromptAnalysisRequest` 新增可选字段 `evaluationSummary?: PromptEvaluationSummary`
- `buildEvaluationContext(summary)` 函数：将评测数据格式化为文本，控制在 ~2000 字符内

#### 4.2.4 Meta-Prompt 模板

**文件**: `packages/client/src/lib/optimization-settings.ts` (修改)

新增 `BUILTIN_META_PROMPTS` 数组，包含 5 个分类模板：

| ID | 名称 | 专用维度 |
|----|------|----------|
| `general` | 通用分析 | 标准五维评估 |
| `codeAssistant` | 代码助手 | 编程语言/错误处理/安全/类型 |
| `contentWriter` | 内容创作 | 受众/语调/SEO/CTA |
| `translator` | 翻译 | 源/目标语言/术语表/格式保持 |
| `dataAnalyzer` | 数据分析 | 数据格式/统计方法/可视化/精度 |

每个模板强调三条核心规则：
1. `originalText` 必须是原文精确子串
2. `messageIndex` 对应 `[MSG-N]` 标记（0-based）
3. 只返回合法 JSON

`OptimizationSettingsData` 新增 `selectedTemplate?: string` 字段，选择后保存到 localStorage。

#### 4.2.5 UI：模板选择器

**文件**: `packages/client/src/components/Prompt/PromptOptimizer.tsx` (修改)

在模型选择器下方新增下拉框，用户可切换模板。切换时自动更新 `analysisPrompt` 到 localStorage。

### 4.3 文件清单

| 文件 | 操作 |
|------|------|
| `packages/shared/src/schemas/optimization.ts` | 新建 |
| `packages/shared/src/schemas/index.ts` | 修改（添加 export） |
| `packages/client/src/lib/model-capabilities.ts` | 修改（新增 inferStructuredOutputSupport） |
| `packages/client/src/lib/prompt-analyzer.ts` | 重写 |
| `packages/client/src/lib/optimization-settings.ts` | 修改（添加 BUILTIN_META_PROMPTS） |
| `packages/client/src/components/Prompt/PromptOptimizer.tsx` | 修改（添加模板选择器） |

### 4.4 验收标准

- [x] 使用支持 json_schema 的模型时，分析结果 100% 可解析
- [x] `messageIndex` 与 `[MSG-N]` 标记一致
- [x] 不支持 json_schema 的模型仍能正常工作（降级路径）
- [x] 5 种 Meta-Prompt 模板可切换

---

## 5. 阶段 2: 评测数据聚合接口

### 5.1 目标

提供以 **evaluationId 为粒度** 的评测聚合 API，支持前端评测选择和数据驱动优化。

### 5.2 设计决策：以单个评测为聚合粒度

同一个 prompt 可关联多个评测（不同目标模型/Judge/标准），跨评测聚合无意义。因此：
- API 提供两层：先查 prompt 关联的评测列表，再查单个评测的聚合摘要
- 前端让用户选择参考哪个评测
- 默认自动选中最近有 completed run 的评测

### 5.3 实现概述

#### 5.3.1 类型定义

**文件**: `packages/shared/src/types/evaluation.ts` (修改，文件末尾追加)

```typescript
// 失败用例详情（用于 topFailures）
interface FailureCaseDetail {
  testCaseId: string;
  testCaseName: string;
  failCount: number;
  totalCount: number;
  latestModelOutput: string;
  latestAiFeedback: Record<string, string>;
  expectedOutput: string | null;
  latestScores: Record<string, number>;
}

// 聚合摘要（核心数据结构）
interface EvaluationSummary {
  evaluationId: string;
  evaluationName: string;
  modelName: string;           // 目标模型名
  judgeModelName: string;      // Judge 模型名
  totalRuns: number;
  latestRunAt: string | null;
  avgPassRate: number;          // 0-1
  avgCriterionScores: Record<string, number>;  // criterion name → avg score
  avgLatencyMs: number;
  avgTokens: number;
  topFailures: FailureCaseDetail[];  // Top 10 失败用例
  recentDelta?: {               // 最近两次 run 的 delta
    passRateChange: number;
    criterionChanges: Record<string, number>;
  };
  criteriaNames?: string[];
  testCaseStats?: TestCaseStat[];   // 全部测试用例统计（验证面板用）
}

// 单个测试用例的聚合统计（验证面板用）
interface TestCaseStat {
  testCaseId: string;
  testCaseName: string;
  inputText: string;               // 测试输入原文
  inputVariables: Record<string, string>;  // 变量替换值
  expectedOutput: string | null;
  passCount: number;
  totalCount: number;
  latestPassed: boolean;
  latestScore: number;             // 最近一次的平均 criterion 得分
  latestModelOutput: string;
}

// 评测列表项（轻量，用于选择器）
interface EvaluationListItem {
  id: string;
  name: string;
  modelName: string;
  judgeModelName: string;
  runCount: number;
  latestRunAt: string | null;
  avgPassRate: number;
}
```

#### 5.3.2 Repository 层

**文件**: `packages/server/src/repositories/evaluations.repository.ts` (修改)

| 方法 | 说明 |
|------|------|
| `findByPromptId(userId, promptId)` | 查某 prompt 关联的所有评测，含 run 数量和最近 run 时间 |
| `findCompletedRunsByEvaluationId(userId, evaluationId, limit=20)` | 查某评测下的 completed runs + testCaseResults + evaluation 详情 |

两个方法均强制 `userId` 过滤（多租户隔离）。

#### 5.3.3 Service 层聚合逻辑

**文件**: `packages/server/src/services/evaluations.service.ts` (修改)

| 方法 | 说明 |
|------|------|
| `getEvaluationsByPromptId(userId, promptId)` | 返回 `EvaluationListItem[]`，映射 model/judgeModel 名称 |
| `getEvaluationSummary(userId, evaluationId)` | 核心聚合，返回 `EvaluationSummary` |

**`getEvaluationSummary` 聚合逻辑**：
1. 调用 `findCompletedRunsByEvaluationId` 获取最近 20 条 completed runs
2. 零 runs → 返回零值结构
3. 遍历所有 runs 的 testCaseResults：
   - 按 run 计算通过率，取平均
   - 按 criterion 累加得分，算各维度均分（处理 Prisma Decimal 类型转换）
   - 按 testCaseId 统计失败次数，取 Top 10 作为 `topFailures`
   - 计算平均延迟和 token 用量
4. 构建 `testCaseStats`：遍历评测的 **全部** testCase，统计 passCount/totalCount/latestPassed/latestScore/latestModelOutput
5. 取最近两次 run 计算 `recentDelta`（passRate 变化 + 各 criterion 得分变化）

#### 5.3.4 Controller & 路由

**文件**: `packages/server/src/controllers/evaluations.controller.ts` (修改)

新增两个 handler：`getByPromptId` 和 `getSummary`。

**文件**: `packages/server/src/routes/prompts.routes.ts` (修改)

```
GET /prompts/:id/evaluations                        → 评测列表
GET /prompts/:id/evaluations/:evaluationId/summary   → 评测聚合摘要
```

挂在 prompts 路由下（语义上是"某个 prompt 的评测"），需 import `evaluationsController`。

#### 5.3.5 前端 API

**文件**: `packages/client/src/api/evaluations.ts` (修改)

```typescript
getByPromptId: (promptId) => apiClient.get<EvaluationListItem[]>(`/prompts/${promptId}/evaluations`),
getSummary: (promptId, evaluationId) => apiClient.get<EvaluationSummary>(`/prompts/${promptId}/evaluations/${evaluationId}/summary`),
```

### 5.4 文件清单

| 文件 | 操作 |
|------|------|
| `packages/shared/src/types/evaluation.ts` | 修改（追加 6 个类型定义） |
| `packages/server/src/repositories/evaluations.repository.ts` | 修改（+2 个方法） |
| `packages/server/src/services/evaluations.service.ts` | 修改（+2 个方法，~200 行聚合逻辑） |
| `packages/server/src/controllers/evaluations.controller.ts` | 修改（+2 个 handler） |
| `packages/server/src/routes/prompts.routes.ts` | 修改（+2 条路由） |
| `packages/client/src/api/evaluations.ts` | 修改（+2 个 API 方法） |

### 5.5 验收标准

- [x] 有评测数据的 prompt：评测列表和聚合结果正确
- [x] 无评测数据的 prompt：返回空列表 / 零值结构（不报错）
- [x] `testCaseStats` 包含全部 testCase（非仅失败用例）
- [x] 多租户隔离：不同用户无法访问彼此的评测数据

---

## 6. 阶段 3: 评测驱动的智能优化

### 6.1 目标

将评测数据注入优化分析流程，让 AI 基于真实失败数据给出针对性建议。

### 6.2 实现概述

#### 6.2.1 PromptsPage 数据流

**文件**: `packages/client/src/pages/PromptsPage.tsx` (修改)

新增状态：
```typescript
const [evalList, setEvalList] = useState<EvaluationListItem[]>([]);
const [evalSummary, setEvalSummary] = useState<EvaluationSummary | null>(null);
const [evalListLoaded, setEvalListLoaded] = useState(false);
```

**`handleOptimize` 增强流程**：
1. 首次分析时自动加载 `evaluationsApi.getByPromptId(promptId)` 获取评测列表
2. 自动选中最近有 completed run 的评测，加载其 summary
3. 将 `evaluationSummary` 传入 `analyzePrompt({ ...request, evaluationSummary })`
4. 将 `evalList` + `evalSummary` + `handleEvaluationSelect` 回调传给 `PromptOptimizer` 组件

**新增 `handleEvaluationSelect(evaluationId)`**：切换评测时重新加载 summary。

**Prompt 切换时重置**：`evalList` / `evalSummary` / `evalListLoaded` / `analysisResult` 全部清零。

#### 6.2.2 评测上下文注入

**文件**: `packages/client/src/lib/prompt-analyzer.ts`

`buildEvaluationContext(summary)` 函数在 `userMessage` 末尾追加：

```
--- EVALUATION DATA ---
Configuration: Target Model=[模型名], Judge Model=[Judge 模型名]
Evaluation Criteria: [criteria 列表]
Total Runs: N, Average Pass Rate: XX.X%
Average Scores by Criterion: criterion1=XX.X, criterion2=XX.X
Recent Trend: Pass Rate ↑/↓X.X%

Top Failure Cases:
  - "用例名" (failed X/Y times)
    Latest Output: [截断到 300 字符]
    Expected: [截断到 200 字符]
    Judge Feedback: [截断到 150 字符]
--- END EVALUATION DATA ---
```

**控制措施**：
- 评测上下文限制在 ~2000 字符，超出时裁剪
- 失败用例最多展示 5 个
- 有评测数据时，system prompt 追加指令：
  - 优先针对高频失败用例建议
  - 说明预期解决的失败
  - 指出 prompt 无法解决的问题

#### 6.2.3 PromptOptimizer 评测选择器 UI

**文件**: `packages/client/src/components/Prompt/PromptOptimizer.tsx` (修改)

新增 props：
```typescript
evaluationList?: EvaluationListItem[]
evaluationSummary?: EvaluationSummary | null
onEvaluationSelect?: (evaluationId: string) => void
```

**UI 结构**：

```
┌─ 优化参考 ──────────────────────────────────────┐
│ 选择参考评测：                                    │
│ [▼ 销售订单 (1 runs, pass rate: 48%) ]            │
│                                                  │
│ Based on: qwen3-max | Judge: GPT-4o              │
│ Pass rate: 48.1% ↓5% | Failures: 10              │
└──────────────────────────────────────────────────┘
```

无评测时：
```
┌─ 优化参考 ──────────────────────────────────────┐
│ 未关联评测集                                      │
│ 将基于静态分析进行优化                              │
└──────────────────────────────────────────────────┘
```

### 6.3 文件清单

| 文件 | 操作 |
|------|------|
| `packages/client/src/pages/PromptsPage.tsx` | 修改（评测状态 + handleOptimize 增强 + props 传递） |
| `packages/client/src/lib/prompt-analyzer.ts` | 修改（buildEvaluationContext + 系统提示词追加） |
| `packages/client/src/components/Prompt/PromptOptimizer.tsx` | 修改（评测选择器 UI + 摘要卡片） |

### 6.4 验收标准

- [x] 有评测数据时：评测选择器正常、切换评测后可重新分析
- [x] 无评测数据时：行为与阶段 1 一致
- [x] 评测摘要卡片正确展示模型信息、通过率、趋势、失败数

---

## 7. 阶段 4: 建议应用升级 + 验证用例面板 + Smoke Test

### 7.1 目标

1. 将建议应用从 `smartReplace` 升级为三级精准 patch，失败时弹出 diff 预览
2. 分析完成后可打开验证用例面板，选择评测用例 + 手动用例跑 smoke test

### 7.2 实现概述

#### 7.2.1 applyPatch 三级匹配

**文件**: `packages/client/src/lib/text-utils.ts` (修改)

```typescript
interface PatchResult {
  success: boolean;
  newContent: string;
  matchStart: number;
  matchEnd: number;
  failReason?: 'no_match' | 'ambiguous_match';
}

function applyPatch(content, originalText, suggestedText): PatchResult
```

三级匹配策略：
1. **精确子串匹配** — 检查歧义（多处匹配返回 `ambiguous_match`）
2. **trim 后匹配** — 首尾空白差异容错
3. **归一化空白后匹配** — 实现位置映射（normalizedContent index → original content index）

保留 `smartReplace` 不删除（向后兼容，作为最后兜底）。

#### 7.2.2 PromptsPage onApplySuggestion 改造

**文件**: `packages/client/src/pages/PromptsPage.tsx` (修改)

新增 `diffPreviewData` 状态，替换原有 `onApplySuggestion` 逻辑：

```
1. applyPatch 尝试目标消息 → 成功则直接应用
2. 失败 → 弹出 SuggestionDiffPreview（不再静默跳过）
3. 无 messageIndex → 遍历所有消息逐个 applyPatch
4. 全部失败 → smartReplace 兜底
5. 仍失败 → 弹出 diff 预览面板
```

#### 7.2.3 SuggestionDiffPreview 组件

**文件**: `packages/client/src/components/Prompt/SuggestionDiffPreview.tsx` (新建)

复用 `packages/client/src/lib/text-diff.ts` 的 `diffText()` 函数（已有 Myers diff 实现，支持 CJK）。

```
┌─ Ambiguous Match / No Match Found ──────────────┐
│ MSG-0 (SYSTEM)                                   │
│                                                  │
│ [红绿 diff 预览]                                  │
│                                                  │
│ [手动编辑文本框] (点击"Manual Edit"展开)           │
│                                                  │
│           [Skip]  [Manual Edit]  [Force Apply]   │
└──────────────────────────────────────────────────┘
```

三个操作：
- **Skip** — 关闭预览
- **Manual Edit** — 展开文本框编辑替换文本，确认后应用
- **Force Apply** — 用 smartReplace 强制应用

#### 7.2.4 验证用例面板

**文件**: `packages/client/src/components/Prompt/PromptOptimizer.tsx` (修改)

**入口**：分析完成后在建议列表下方显示"验证效果"按钮（无需先 apply 建议），点击打开验证面板。

**用例来源三种**：

**a) 来自选中评测的用例（有评测集时）**

从 `evaluationSummary.testCaseStats` 获取 **全部** test case，按状态分组：

```
┌─ 验证用例 ──────────────────────────────────────┐
│                                                  │
│ ▼ 来自评测"销售订单"                               │
│   失败用例（验证优化效果）                          │
│   ☑ 长文翻译    Fail 60%    最近得分: 42          │
│   ☑ 专业术语    Fail 33%    最近得分: 65          │
│                                                  │
│   成功用例（回归测试，可选）                        │
│   ☐ 短句翻译    Pass 100%   最近得分: 95          │
│   ☐ 日常对话    Pass 100%   最近得分: 92          │
│                                                  │
│ ▼ 手动添加的用例                                   │
│   ┌──────────────────────────────────────┐       │
│   │ 输入: ...                             │       │
│   │ 期望输出（可选）: ...                  │       │
│   │                   [+ Add Case]        │       │
│   └──────────────────────────────────────┘       │
│                                                  │
│         [Verify Effect (5 cases)]                 │
└──────────────────────────────────────────────────┘
```

关键交互：
- 失败用例默认勾选，成功用例默认不勾选
- 每个用例显示历史通过率和最近得分
- 面板右上角有关闭按钮

**b) 用户手动添加的临时 case**

- 输入框 + 期望输出（可选）
- 不持久化到数据库，仅当前优化会话有效
- 可删除已添加的用例

**c) 无评测集的纯手动模式**

- 不展示评测用例区
- 提示"未关联评测集，请手动添加测试用例"
- 仅展示手动添加区

#### 7.2.5 Smoke Test 执行

**执行流程**：
1. 遍历勾选的 case
2. 用当前（已优化的）prompt messages + case 的 `inputText` 拼装消息
   - 评测 case：支持 `inputVariables` 变量替换（`{{var}}` → 值）
   - 手动 case：直接用输入内容
3. 调用 `chatApi.complete` 获取模型输出
4. 评分：
   - 有 `expectedOutput` → token 重叠率评分（精确匹配=100, 包含=70, 重叠比例计算）
   - 无 `expectedOutput` → 仅展示输出（无 afterScore）
5. 回归检测：成功用例的 afterScore < latestScore → 标记 `isRegression`

**结果展示**：

```
┌─ 结果 ──────────────────────────────────────────┐
│ Case          Before    After    Status           │
│ 长文翻译        42       78 ↑    ✓                │
│ 专业术语        65       71 ↑    ✓                │
│ 短句翻译        95       72 ⚠️    ✓  ← 回归风险    │
│ Manual Test 1   -        -       ✓                │
│                                                  │
│ ⚠️ 回归风险！部分成功用例可能受到影响               │
│                                                  │
│ ▼ 输出预览                                        │
│   长文翻译: [模型输出...]                          │
│   专业术语: [模型输出...]                          │
└──────────────────────────────────────────────────┘
```

### 7.3 文件清单

| 文件 | 操作 |
|------|------|
| `packages/client/src/lib/text-utils.ts` | 修改（+PatchResult + applyPatch） |
| `packages/client/src/components/Prompt/SuggestionDiffPreview.tsx` | 新建 |
| `packages/client/src/components/Prompt/index.ts` | 修改（+export） |
| `packages/client/src/pages/PromptsPage.tsx` | 修改（onApplySuggestion 改造 + diffPreviewData） |
| `packages/client/src/components/Prompt/PromptOptimizer.tsx` | 修改（验证面板 + smoke test） |

### 7.4 验收标准

- [x] `applyPatch` 精确匹配和 trim 匹配工作正常
- [x] 匹配失败时弹出 diff 预览（不再静默跳过）
- [x] 验证面板展示评测全部 test case（失败/成功分组）
- [x] 手动添加临时 case 可创建、勾选、删除
- [x] Smoke test 正确执行并展示 before/after 对比
- [x] 回归风险检测标红

---

## 8. 完整文件变更清单

| 文件 | 阶段 | 操作 |
|------|------|------|
| `packages/shared/src/schemas/optimization.ts` | 1 | 新建 |
| `packages/shared/src/schemas/index.ts` | 1 | 修改 |
| `packages/shared/src/types/evaluation.ts` | 2 | 修改 |
| `packages/client/src/lib/model-capabilities.ts` | 1 | 修改 |
| `packages/client/src/lib/prompt-analyzer.ts` | 1, 3 | 重写 |
| `packages/client/src/lib/optimization-settings.ts` | 1 | 修改 |
| `packages/client/src/lib/text-utils.ts` | 4 | 修改 |
| `packages/client/src/components/Prompt/PromptOptimizer.tsx` | 1, 3, 4 | 多阶段修改 |
| `packages/client/src/components/Prompt/SuggestionDiffPreview.tsx` | 4 | 新建 |
| `packages/client/src/components/Prompt/index.ts` | 4 | 修改 |
| `packages/client/src/pages/PromptsPage.tsx` | 3, 4 | 修改 |
| `packages/server/src/repositories/evaluations.repository.ts` | 2 | 修改 |
| `packages/server/src/services/evaluations.service.ts` | 2 | 修改 |
| `packages/server/src/controllers/evaluations.controller.ts` | 2 | 修改 |
| `packages/server/src/routes/prompts.routes.ts` | 2 | 修改 |
| `packages/client/src/api/evaluations.ts` | 2 | 修改 |

---

## 9. 后续规划（不在本 PRD 范围）

| 方向 | 说明 |
|------|------|
| Judge 模型打分集成 | Smoke test 使用评测的 judge model + criteria 打分，而非简单文本对比 |
| 多候选并行优化 | 生成 N 个变体，用评测自动选 Top1 |
| 迭代式自动优化 | 循环"优化 → 评测 → 再优化"，收敛到目标分数 |
| 优化配置服务端化 | meta-prompt 和设置迁移到后端，支持团队共享 |
| Token 成本对比 | apply 建议时实时展示 token 增量 |
| 分析改流式渲染 | 用 streamWithCallbacks 替代 complete，逐步展示结果 |
| 验证结果持久化 | Smoke test 结果保存到数据库，支持历史对比 |

---

## 10. 风险与缓解

| 风险 | 影响 | 缓解措施 |
|------|------|----------|
| 部分模型不支持 `json_schema` | 阶段 1 无法使用结构化输出 | 三级降级：json_schema → json_object → regex fallback |
| 评测数据量大时聚合查询慢 | 阶段 2 接口超时 | 限制查询 20 条 run，按 evaluationId 而非 promptId 聚合 |
| Smoke test 消耗 API 额度 | 阶段 4 用户成本增加 | 用户手动勾选 case，默认只选失败用例 |
| 模型返回的 `originalText` 仍不精确 | 阶段 1 后 apply 成功率未达预期 | 三级 patch 匹配 + diff 编辑器兜底（不再静默跳过） |
| Smoke test 评分不够准确 | 简单文本对比不如 Judge 模型 | 后续集成 Judge 模型评分（见后续规划） |
