# PRD: Prompt 优化系统 v2.0

> 版本: 1.0 | 作者: Claude Code | 日期: 2026-03-01

---

## 1. 背景与问题

当前 SSRPrompt 的 Prompt 优化功能存在三个核心短板：

### 1.1 单次静态分析，无闭环验证

优化器（`PromptOptimizer`）只做"分析 → 给建议"，用户手动 apply 后没有任何自动验证。无法回答"这条建议到底有没有用"。

**现状代码路径**:
```
用户点击"分析" → prompt-analyzer.ts 调 chatApi.complete → 返回建议列表 → 用户手动 apply → 结束
```

### 1.2 优化输出依赖自由文本解析，稳定性差

`prompt-analyzer.ts:53` 调用 `chatApi.complete` 时未传 `responseFormat`，靠正则 fallback 解析 JSON。模型返回格式不一致时，建议列表直接丢失（静默降级为空数组）。

### 1.3 建议应用靠字符串模糊匹配，可靠性低

`text-utils.ts:163` 的 `smartReplace` 用滑动窗口做 markdown-stripped 匹配。当模型返回的 `originalText` 与实际内容有细微差异（空格、换行、标点）时匹配失败，`replaced: false` 静默跳过。

### 1.4 评测数据与优化器完全隔离

评测系统已积累了丰富的运行结果（`TestCaseResult` 含 scores/aiFeedback/passed），但优化器完全不知道这些数据的存在。优化建议只基于静态文本分析，不参考真实表现。

**数据获取现状**:
```
Prompt → Evaluation (evaluation.promptId) → EvaluationRun → TestCaseResult
                                                              ↑
当前需要 3 跳才能拿到，且无按 promptId 聚合的服务端接口
```

---

## 2. 目标

1. **优化建议的可复现性**: 相同输入产生一致的结构化输出，消除解析失败
2. **优化建议的有效性**: 基于真实评测数据给出针对性建议，而非通用规则
3. **优化效果的可验证性**: 建议 apply 后自动跑 smoke test，用数据证明效果
4. **建议应用的可靠性**: 消除字符串匹配失败问题，提供 diff 预览

---

## 3. 整体方案

分 4 个阶段交付，每阶段可独立上线。

```
阶段 1: 结构化输出 + Meta-Prompt 模板    → 解决"解析不稳定"
阶段 2: 评测数据聚合接口                  → 解决"数据获取"前置依赖
阶段 3: 评测驱动的智能优化                → 解决"建议无效"
阶段 4: 建议应用升级 + 自动验证闭环       → 解决"应用不可靠 + 无法验证"
```

---

## 4. 阶段 1: 结构化输出 + Meta-Prompt 模板

### 4.1 目标

消除优化分析的解析失败，将建议输出从"自由文本 + regex fallback"升级为"json_schema 强约束"。

### 4.2 改动范围

| 文件 | 改动 |
|------|------|
| `packages/client/src/lib/prompt-analyzer.ts` | 核心改造 |
| `packages/client/src/lib/optimization-settings.ts` | 新增 meta-prompt 模板 |
| `packages/shared/src/schemas/optimization.ts` | 新增: JSON Schema 定义 |

### 4.3 详细设计

#### 4.3.1 定义优化输出的 JSON Schema

在 `packages/shared/src/schemas/` 新增 `optimization.ts`:

```typescript
// 优化分析结果的 JSON Schema（传给 responseFormat）
export const OPTIMIZATION_RESULT_SCHEMA = {
  type: 'json_schema' as const,
  json_schema: {
    name: 'prompt_analysis',
    strict: true,
    schema: {
      type: 'object',
      required: ['score', 'summary', 'strengths', 'suggestions'],
      additionalProperties: false,
      properties: {
        score: {
          type: 'integer',
          minimum: 0,
          maximum: 100,
          description: '综合评分',
        },
        summary: {
          type: 'string',
          description: '一句话总结',
        },
        strengths: {
          type: 'array',
          items: { type: 'string' },
          description: '优点列表',
        },
        suggestions: {
          type: 'array',
          items: {
            type: 'object',
            required: ['type', 'severity', 'title', 'description',
                       'messageIndex', 'originalText', 'suggestedText'],
            additionalProperties: false,
            properties: {
              type: {
                type: 'string',
                enum: ['clarity', 'structure', 'specificity', 'examples', 'constraints'],
              },
              severity: {
                type: 'string',
                enum: ['high', 'medium', 'low'],
              },
              title: { type: 'string' },
              description: { type: 'string' },
              messageIndex: {
                type: 'integer',
                minimum: 0,
                description: '目标消息的索引号（对应 [MSG-0], [MSG-1] 等标记）',
              },
              originalText: {
                type: 'string',
                description: '需要替换的原文，必须是消息中的精确子串',
              },
              suggestedText: {
                type: 'string',
                description: '替换后的文本',
              },
            },
          },
        },
      },
    },
  },
};
```

#### 4.3.2 改造 prompt-analyzer.ts

核心改动:

```typescript
// BEFORE: 无 responseFormat，靠 regex 解析
const result = await chatApi.complete({
  modelId,
  messages: [...],
  saveTrace: false,
});
// 然后 JSON.parse + regex fallback...

// AFTER: 传入 responseFormat，直接 JSON.parse
import { OPTIMIZATION_RESULT_SCHEMA } from '@ssrprompt/shared/schemas/optimization';

const result = await chatApi.complete({
  modelId,
  messages: [
    { role: 'system', content: analysisSystemPrompt },
    { role: 'user', content: userMessage },
  ],
  saveTrace: false,
  responseFormat: OPTIMIZATION_RESULT_SCHEMA,
});

// 模型输出已被约束为合法 JSON，直接 parse
const parsed = JSON.parse(result.content);
```

**消除 regex fallback 分支**: 有了 json_schema 约束，`prompt-analyzer.ts:65-105` 的整段 fallback 逻辑可以移除，仅保留一个 try/catch 兜底。

#### 4.3.3 增强消息标记

在构建 user message 时，给每条消息加上明确的索引标记：

```typescript
// BEFORE
request.messages.map((m, i) =>
  `[消息 ${i + 1} - ${m.role.toUpperCase()}]\n${m.content}`
)

// AFTER — 使用 [MSG-N] 标记，与 schema 中的 messageIndex 对应
request.messages.map((m, i) =>
  `[MSG-${i}] (${m.role.toUpperCase()})\n${m.content}`
)
```

这样模型返回的 `messageIndex` 就能与实际消息准确对应。

#### 4.3.4 内置 Meta-Prompt 模板

当前 `getOptimizationSettings()` 返回的 `analysisPrompt` 可能为空，fallback 到 i18n 翻译文本（质量不可控）。

新增内置模板库，按用途分类:

```typescript
// packages/client/src/lib/optimization-settings.ts 新增
export const BUILTIN_META_PROMPTS = {
  general: '...通用分析模板...',
  codeAssistant: '...代码助手专用模板...',
  contentWriter: '...内容创作专用模板...',
  translator: '...翻译专用模板...',
  dataAnalyzer: '...数据分析专用模板...',
} as const;
```

每个模板需包含:
- 明确的输出格式说明（虽然有 json_schema 兜底，prompt 中仍需描述期望结构）
- 该类型 prompt 的特定评估维度
- `originalText` 必须是精确子串的强调说明

### 4.4 兼容性

- `responseFormat: json_schema` 并非所有模型都支持。需要检测模型能力，不支持时 fallback 到 `responseFormat: { type: 'json_object' }`，保留现有的 regex 解析作为最终兜底
- 可参考现有 `inferReasoningSupport` 的模式，新增 `inferStructuredOutputSupport`

### 4.5 验收标准

- [ ] 使用支持 json_schema 的模型时，分析结果 100% 可解析（不触发 fallback）
- [ ] `messageIndex` 与实际消息索引一致率 > 95%
- [ ] `originalText` 在目标消息中的精确匹配率 > 80%（对比现状的 ~50%）
- [ ] 不支持 json_schema 的模型仍能正常工作（降级路径）

---

## 5. 阶段 2: 评测数据聚合接口

### 5.1 目标

提供按 `promptId` 聚合的评测摘要接口，作为后续"评测驱动优化"的数据基础。

### 5.2 改动范围

| 层 | 文件 | 改动 |
|----|------|------|
| 类型 | `packages/shared/src/types/evaluation.ts` | 新增 `PromptEvaluationSummary` 类型 |
| Repository | `packages/server/src/repositories/evaluations.repository.ts` | 新增 `findRunsByPromptId` 方法 |
| Service | `packages/server/src/services/evaluations.service.ts` | 新增 `getPromptEvaluationSummary` 方法 |
| Controller | `packages/server/src/controllers/evaluations.controller.ts` | 新增 handler |
| Route | `packages/server/src/routes/prompts.routes.ts` | 新增 `GET /prompts/:id/evaluation-summary` |
| 前端 API | `packages/client/src/api/evaluations.ts` | 新增 `getPromptSummary` 方法 |

### 5.3 详细设计

#### 5.3.1 类型定义

```typescript
// packages/shared/src/types/evaluation.ts 新增

export interface FailureCaseDetail {
  testCaseId: string;
  testCaseName: string;
  failCount: number;
  totalCount: number;
  latestModelOutput: string;
  latestAiFeedback: Record<string, string>;
  expectedOutput: string | null;
  latestScores: Record<string, number>;
}

export interface PromptEvaluationSummary {
  promptId: string;
  totalEvaluations: number;
  totalRuns: number;
  latestRunAt: string | null;

  // 聚合指标
  avgPassRate: number;           // 0-100
  avgCriterionScores: Array<{
    criterion: string;
    avgScore: number;
    weight: number;
  }>;
  avgLatencyMs: number;
  avgTokens: {
    input: number;
    output: number;
  };

  // 高频失败用例（按失败次数降序，取 Top 10）
  topFailures: FailureCaseDetail[];

  // 最近两次 completed run 的 delta
  recentDelta: {
    passRateDelta: number;       // 正数=提升，负数=退化
    avgScoreDelta: number;
    latencyDeltaMs: number;
  } | null;
}
```

#### 5.3.2 Repository 层

在 `EvaluationsRepositoryClass` 中新增:

```typescript
/**
 * 查询某个 prompt 关联的所有 completed runs 及其 results
 * 单次 JOIN 查询，避免 N+1
 */
async findCompletedRunsByPromptId(
  userId: string,
  promptId: string,
  limit = 20
): Promise<Array<EvaluationRun & {
  testCaseResults: TestCaseResult[];
  evaluation: {
    id: string;
    name: string;
    testCases: TestCase[];
    criteria: EvaluationCriterion[];
  };
}>> {
  return prisma.evaluationRun.findMany({
    where: {
      status: 'completed',
      evaluation: {
        promptId,
        userId,   // 多租户隔离
      },
    },
    include: {
      testCaseResults: true,
      evaluation: {
        include: {
          testCases: { orderBy: { orderIndex: 'asc' } },
          criteria: { where: { enabled: true } },
        },
      },
    },
    orderBy: { createdAt: 'desc' },
    take: limit,
  });
}
```

**设计决策**:
- 只查 `status: 'completed'` 的 run，排除 pending/running/failed
- 强制 `userId` 过滤，遵循多租户隔离规范
- 限制最多 20 条 run，避免数据量过大
- 单次查询含 JOIN，避免前端多跳问题

#### 5.3.3 Service 层聚合逻辑

```typescript
// evaluations.service.ts 新增
async getPromptEvaluationSummary(
  userId: string,
  promptId: string
): Promise<PromptEvaluationSummary> {
  const runs = await this.evaluationsRepo.findCompletedRunsByPromptId(userId, promptId);

  if (runs.length === 0) {
    return {
      promptId,
      totalEvaluations: 0,
      totalRuns: 0,
      latestRunAt: null,
      avgPassRate: 0,
      avgCriterionScores: [],
      avgLatencyMs: 0,
      avgTokens: { input: 0, output: 0 },
      topFailures: [],
      recentDelta: null,
    };
  }

  // 聚合计算:
  // 1. 遍历所有 runs 的 testCaseResults 计算通过率、各 criterion 平均分
  // 2. 统计每个 testCase 的失败次数，取 Top 10
  // 3. 取最近两次 run 计算 delta
  // （具体实现可复用 evaluation-analysis.ts 中的 summarizeRun 逻辑）
}
```

#### 5.3.4 路由挂载

挂在 prompts 路由下（语义上是"某个 prompt 的评测摘要"）:

```typescript
// packages/server/src/routes/prompts.routes.ts
router.get('/:id/evaluation-summary',
  asyncHandler(evaluationsController.getPromptSummary));
```

#### 5.3.5 前端 API

```typescript
// packages/client/src/api/evaluations.ts 新增
getPromptSummary: (promptId: string) =>
  apiClient.get<PromptEvaluationSummary>(`/prompts/${promptId}/evaluation-summary`),
```

### 5.4 性能考量

- **索引**: `evaluation` 表的 `(promptId, userId)` 应有复合索引（检查现有 schema）
- **缓存**: 评测数据不频繁变化，可在 service 层加短时内存缓存（TTL 60s）
- **数据量**: 20 runs × 平均 20 test cases = ~400 条 TestCaseResult，单次查询可接受

### 5.5 验收标准

- [ ] `GET /prompts/:id/evaluation-summary` 在有评测数据时正确返回聚合结果
- [ ] 无评测数据时返回零值结构（不报错）
- [ ] 响应时间 < 500ms（20 runs 规模）
- [ ] 严格遵循多租户隔离（不返回其他用户的私有评测数据）

---

## 6. 阶段 3: 评测驱动的智能优化

### 6.1 目标

将评测数据注入优化分析流程，让 AI 基于真实失败数据给出针对性建议。

### 6.2 改动范围

| 文件 | 改动 |
|------|------|
| `packages/client/src/lib/prompt-analyzer.ts` | 扩展 `analyzePrompt` 入参，注入评测上下文 |
| `packages/client/src/components/Prompt/PromptOptimizer.tsx` | 加载评测摘要并传递 |
| `packages/client/src/pages/PromptsPage.tsx` | 调用评测摘要 API，串联数据 |

### 6.3 详细设计

#### 6.3.1 扩展 analyzePrompt 接口

```typescript
// prompt-analyzer.ts

export interface PromptAnalysisRequest {
  messages: PromptMessage[];
  content: string;
  variables: PromptVariable[];
  evaluationSummary?: PromptEvaluationSummary;  // 新增
}

export async function analyzePrompt(
  modelId: string,
  request: PromptAnalysisRequest
): Promise<PromptAnalysisResult> {
  // ...构建基础 user message...

  // 注入评测上下文
  if (request.evaluationSummary && request.evaluationSummary.totalRuns > 0) {
    const summary = request.evaluationSummary;
    userMessage += `\n\n---\n## 历史评测数据（基于 ${summary.totalRuns} 次运行）\n`;
    userMessage += `- 平均通过率: ${summary.avgPassRate.toFixed(1)}%\n`;
    userMessage += `- 平均延迟: ${summary.avgLatencyMs.toFixed(0)}ms\n`;

    if (summary.avgCriterionScores.length > 0) {
      userMessage += `\n### 各评估维度得分:\n`;
      for (const cs of summary.avgCriterionScores) {
        userMessage += `- ${cs.criterion}: ${cs.avgScore.toFixed(1)} (权重 ${cs.weight})\n`;
      }
    }

    if (summary.topFailures.length > 0) {
      userMessage += `\n### 高频失败用例（请重点针对这些问题给出优化建议）:\n`;
      for (const f of summary.topFailures.slice(0, 5)) {
        userMessage += `\n**${f.testCaseName}** (失败 ${f.failCount}/${f.totalCount} 次)\n`;
        userMessage += `- 模型输出摘要: ${truncate(f.latestModelOutput, 300)}\n`;
        if (f.expectedOutput) {
          userMessage += `- 期望输出: ${truncate(f.expectedOutput, 200)}\n`;
        }
        if (Object.keys(f.latestAiFeedback).length > 0) {
          userMessage += `- Judge 反馈: ${JSON.stringify(f.latestAiFeedback)}\n`;
        }
      }
    }

    if (summary.recentDelta) {
      const d = summary.recentDelta;
      userMessage += `\n### 近期趋势:\n`;
      userMessage += `- 通过率变化: ${d.passRateDelta > 0 ? '+' : ''}${d.passRateDelta.toFixed(1)}%\n`;
    }
  }
}
```

#### 6.3.2 前端数据流

```
PromptsPage
  ├── 打开优化 Tab 时 → 调用 evaluationsApi.getPromptSummary(promptId)
  ├── 将 summary 传给 PromptOptimizer
  └── PromptOptimizer
        ├── 展示评测摘要卡片（通过率、失败数等）
        ├── 点击"分析" → 调用 analyzePrompt(modelId, { ...request, evaluationSummary })
        └── 建议列表中标记"基于失败用例"的建议
```

#### 6.3.3 优化器 UI 增强

在 `PromptOptimizer.tsx` 的 Score Card 下方新增评测数据卡片:

```
┌─ 历史评测 ──────────────────────────┐
│ 📊 基于 12 次评测运行               │
│ 通过率: 73.5%  ↑2.1%               │
│ 高频失败: 3 个用例                  │
│ [查看详情]  [仅优化失败用例]         │
└─────────────────────────────────────┘
```

### 6.4 Meta-Prompt 增强

当有评测数据时，system prompt 末尾追加指令:

```
## 附加指令
用户提供了历史评测数据。请优先针对高频失败用例给出具体的优化建议。
对于每条建议，说明它预期能解决哪些失败用例。
如果失败原因是 prompt 本身无法解决的（如模型能力限制），请在 description 中明确指出。
```

### 6.5 验收标准

- [ ] 有评测数据时，分析结果中至少 1 条建议引用了具体失败用例
- [ ] 无评测数据时，行为与阶段 1 一致（不报错）
- [ ] 评测摘要卡片正确展示通过率和趋势
- [ ] 分析请求中评测上下文不超过总 token 的 30%（避免喧宾夺主）

---

## 7. 阶段 4: 建议应用升级 + 自动验证闭环

### 7.1 目标

1. 将建议应用从 `smartReplace` 升级为基于 `messageIndex` 的精准 patch + diff 预览
2. 建议 apply 后自动跑 smoke test，用评分 delta 验证效果

### 7.2 改动范围

| 文件 | 改动 |
|------|------|
| `packages/client/src/pages/PromptsPage.tsx` | 替换 `smartReplace` 调用 |
| `packages/client/src/lib/text-utils.ts` | 新增 `applyPatch` 方法 |
| `packages/client/src/components/Prompt/PromptOptimizer.tsx` | 新增 diff 预览 + 验证 UI |
| `packages/client/src/components/Prompt/SuggestionDiffPreview.tsx` | 新增: diff 预览组件 |

### 7.3 详细设计

#### 7.3.1 建议应用升级

**现状问题** (`PromptsPage.tsx:2452`):
```typescript
// 当前: 靠 smartReplace 模糊匹配，容易失败
const result = smartReplace(
  promptMessages[suggestion.messageIndex].content,
  suggestion.originalText,
  suggestion.suggestedText
);
```

**改造方案**:

```typescript
// 新增: packages/client/src/lib/text-utils.ts

export interface PatchResult {
  success: boolean;
  newContent: string;
  matchStart: number;   // 匹配起始位置（用于高亮）
  matchEnd: number;     // 匹配结束位置
  failReason?: 'no_match' | 'ambiguous_match';  // 失败原因
}

/**
 * 分级匹配策略:
 * 1. 精确子串匹配（最可靠）
 * 2. 忽略首尾空白的匹配
 * 3. 归一化空白字符后匹配
 * 4. 全部失败 → 返回 success: false + failReason
 *
 * 不再使用 markdown-strip 的模糊匹配，避免误替换
 */
export function applyPatch(
  content: string,
  originalText: string,
  suggestedText: string
): PatchResult {
  // Level 1: 精确匹配
  const exactIdx = content.indexOf(originalText);
  if (exactIdx !== -1) {
    // 检查是否有多处匹配（歧义）
    const secondIdx = content.indexOf(originalText, exactIdx + 1);
    if (secondIdx !== -1) {
      return { success: false, newContent: content, matchStart: -1, matchEnd: -1, failReason: 'ambiguous_match' };
    }
    return {
      success: true,
      newContent: content.slice(0, exactIdx) + suggestedText + content.slice(exactIdx + originalText.length),
      matchStart: exactIdx,
      matchEnd: exactIdx + originalText.length,
    };
  }

  // Level 2: trim 后匹配
  const trimmed = originalText.trim();
  const trimIdx = content.indexOf(trimmed);
  if (trimIdx !== -1) {
    return {
      success: true,
      newContent: content.slice(0, trimIdx) + suggestedText + content.slice(trimIdx + trimmed.length),
      matchStart: trimIdx,
      matchEnd: trimIdx + trimmed.length,
    };
  }

  // Level 3: 归一化空白后匹配
  const normalize = (s: string) => s.replace(/\s+/g, ' ').trim();
  const normalizedOrig = normalize(originalText);
  const normalizedContent = normalize(content);
  const normIdx = normalizedContent.indexOf(normalizedOrig);
  if (normIdx !== -1) {
    // 需要映射回原始位置（此处简化，实际需要位置映射）
    // ...
  }

  return { success: false, newContent: content, matchStart: -1, matchEnd: -1, failReason: 'no_match' };
}
```

**调用方改造** (`PromptsPage.tsx`):

```typescript
onApplySuggestion={(suggestion) => {
  if (!suggestion.originalText || !suggestion.suggestedText) return;
  if (suggestion.messageIndex === undefined) return;  // 必须有 messageIndex

  const msg = promptMessages[suggestion.messageIndex];
  if (!msg) return;

  const result = applyPatch(msg.content, suggestion.originalText, suggestion.suggestedText);

  if (result.success) {
    // 直接应用
    const newMessages = [...promptMessages];
    newMessages[suggestion.messageIndex] = { ...msg, content: result.newContent };
    setPromptMessages(newMessages);
  } else {
    // 匹配失败 → 弹出手动编辑 diff 面板（而非静默跳过）
    openDiffEditor(suggestion);
  }
}}
```

#### 7.3.2 Diff 预览组件

新增 `SuggestionDiffPreview.tsx`:

```
┌─ 建议预览 ────────────────────────────────┐
│ 消息 #0 (SYSTEM)                          │
│                                            │
│  你是一个专业的翻译助手。                   │
│ -请将用户输入翻译为目标语言。              │  ← 红色删除
│ +请将用户输入翻译为 {{target_language}}，   │  ← 绿色新增
│ +保持原文的语气和格式。                    │
│  如果不确定，请询问用户。                   │
│                                            │
│         [应用]  [跳过]  [手动编辑]          │
└────────────────────────────────────────────┘
```

技术选型: 使用 `diff` npm 包（已广泛使用）生成行级 diff。

#### 7.3.3 自动 Smoke Test

用户 apply 一条或多条建议后，显示"验证效果"按钮:

**流程**:

```
1. 用户 apply 建议
2. 点击"验证效果"
3. 前端查找该 prompt 关联的评测:
   - 取最近一个有 completed run 的 evaluation
   - 从中选取失败过的 test cases（最多 5 个）作为 smoke set
4. 用 apply 后的新 prompt 内容 + 原评测配置，调用 chat API 逐个跑 smoke cases
5. 用原评测的 criteria + judge model 对结果打分
6. 展示对比:
   ┌─ 验证结果 ─────────────────────────────┐
   │ Test Case       Before    After   Delta │
   │ "长文翻译"        42分     78分   +36 ↑ │
   │ "专业术语"        65分     71分    +6 ↑ │
   │ "格式保持"        80分     78分    -2 ↓ │
   │                                         │
   │ 综合: 通过率 33% → 67%  (+34%)          │
   │                                         │
   │      [保留优化]  [回退]                  │
   └─────────────────────────────────────────┘
```

**数据获取**: 复用阶段 2 的 `PromptEvaluationSummary.topFailures` 中的 `testCaseId` 来选取 smoke cases，再调用已有的 `evaluationsApi` 获取完整 test case 数据。

**实现要点**:
- Smoke test 在前端执行（复用 `EvaluationPage` 中已有的 test case 运行逻辑）
- 不创建正式的 `EvaluationRun` 记录，仅做临时对比
- Before 分数从 `PromptEvaluationSummary.topFailures.latestScores` 获取，无需重跑

### 7.4 验收标准

- [ ] 建议 apply 成功率 > 95%（阶段 1 的 json_schema + messageIndex 增强后）
- [ ] apply 失败时弹出 diff 编辑器（不再静默跳过）
- [ ] Smoke test 能在 30 秒内完成（5 个 case）
- [ ] 验证结果正确展示 before/after 对比

---

## 8. 后续规划（不在本 PRD 范围，仅记录方向）

| 方向 | 说明 |
|------|------|
| 多候选并行优化 | 生成 N 个变体，用评测自动选 Top1 |
| 迭代式自动优化 | 循环"优化 → 评测 → 再优化"，收敛到目标分数 |
| 优化配置服务端化 | meta-prompt 和设置迁移到后端，支持团队共享 |
| Token 成本对比 | apply 建议时实时展示 token 增量 |
| 分析改流式渲染 | 用 streamWithCallbacks 替代 complete，逐步展示结果 |

---

## 9. 风险与依赖

| 风险 | 影响 | 缓解措施 |
|------|------|----------|
| 部分模型不支持 `json_schema` | 阶段 1 无法使用结构化输出 | 检测模型能力，fallback 到 `json_object` + 现有解析 |
| 评测数据量大时聚合查询慢 | 阶段 2 接口超时 | 限制查询 20 条 run，加数据库索引 |
| Smoke test 消耗 API 额度 | 阶段 4 用户成本增加 | 限制 smoke cases 数量（最多 5 个），显示预估成本 |
| 模型返回的 `originalText` 仍不精确 | 阶段 1 后 apply 成功率未达预期 | 在 meta-prompt 中强调"精确子串"要求 + diff 编辑器兜底 |

---

## 10. 里程碑

| 阶段 | 交付物 | 依赖 |
|------|--------|------|
| 阶段 1 | json_schema + meta-prompt + messageIndex 增强 | 无 |
| 阶段 2 | `GET /prompts/:id/evaluation-summary` 接口 | 无（可与阶段 1 并行） |
| 阶段 3 | 评测数据注入优化分析流程 | 阶段 1 + 阶段 2 |
| 阶段 4 | patch 升级 + diff 预览 + smoke test 闭环 | 阶段 1 + 阶段 2 + 阶段 3 |
