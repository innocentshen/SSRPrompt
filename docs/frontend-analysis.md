# SSRPrompt 前端代码分析报告

## 1. 项目结构概览

```
src/
├── pages/           # 页面组件 (7个)
├── components/      # 可复用组件 (41个)
│   ├── ui/          # 基础UI组件 (13个)
│   ├── Prompt/      # Prompt相关组件 (11个)
│   ├── Evaluation/  # 评测相关组件 (5个)
│   ├── Settings/    # 设置相关组件 (8个)
│   ├── Layout/      # 布局组件 (4个)
│   └── Setup/       # 初始化向导 (1个)
├── store/           # Zustand状态管理 (7个)
├── lib/             # 工具库
│   └── database/    # 数据库抽象层
├── types/           # TypeScript类型定义
└── locales/         # 国际化文件 (4种语言)
```

---

## 2. 页面组件分析

| 文件 | 行数 | 功能描述 | 复杂度 |
|------|------|----------|--------|
| **PromptsPage.tsx** | 2,036 | Prompt编辑主页面 | **极高** |
| **EvaluationPage.tsx** | 1,869 | 评测中心主页面 | **极高** |
| **PromptWizardPage.tsx** | 820 | AI引导创建向导 | 高 |
| **TracesPage.tsx** | 722 | 执行历史查看 | 中 |
| **SettingsPage.tsx** | 320 | 设置页面 | 低 |
| **LoginPage.tsx** | 131 | 登录页面 | 低 |
| **HomePage.tsx** | 90 | 首页导航 | 低 |

### 需要重构的大文件

#### PromptsPage.tsx (2,036行) - **严重**
包含过多职责：
- Prompt CRUD操作
- 消息编辑器
- 变量管理
- 参数配置
- 调试历史
- AI测试面板
- 文件上传
- 结构化输出配置

**建议拆分为：**
- `PromptEditor.tsx` - 核心编辑器
- `PromptTestPanel.tsx` - 测试面板
- `PromptConfigPanel.tsx` - 配置面板
- `usePromptEditor.ts` - 编辑器逻辑Hook

#### EvaluationPage.tsx (1,869行) - **严重**
包含过多职责：
- 评测任务管理
- 测试用例管理
- 评价标准管理
- 执行历史
- 结果展示
- AI评测执行逻辑

**建议拆分为：**
- `EvaluationManager.tsx` - 任务管理
- `EvaluationRunner.tsx` - 执行逻辑
- `useEvaluationRunner.ts` - 执行逻辑Hook

---

## 3. 组件分析

### 3.1 UI基础组件 (src/components/ui/)

| 组件 | 行数 | 复用度 | 说明 |
|------|------|--------|------|
| ModelSelector.tsx | 227 | 高 | 模型选择器，多处使用 |
| MarkdownRenderer.tsx | 93 | 高 | Markdown渲染 |
| Slider.tsx | 97 | 中 | 滑块组件 |
| Toast.tsx | 80 | 高 | 全局通知 |
| Tabs.tsx | 77 | 高 | 标签页 |
| Modal.tsx | 60 | 高 | 模态框 |
| Collapsible.tsx | 51 | 中 | 折叠面板 |
| Select.tsx | 46 | 高 | 下拉选择 |
| Button.tsx | 45 | 高 | 按钮 |
| Toggle.tsx | 45 | 中 | 开关 |
| Input.tsx | 34 | 高 | 输入框 |
| Badge.tsx | 24 | 中 | 标签 |

**评价：** UI组件设计良好，职责单一，复用度高。

### 3.2 Prompt组件 (src/components/Prompt/)

| 组件 | 行数 | 说明 |
|------|------|------|
| **StructuredOutputEditor.tsx** | 574 | JSON Schema编辑器 |
| **PromptOptimizer.tsx** | 404 | Prompt优化建议 |
| **PromptObserver.tsx** | 393 | 执行监控 |
| DebugHistory.tsx | 231 | 调试历史 |
| MessageList.tsx | 212 | 消息列表 |
| VariableEditor.tsx | 206 | 变量编辑 |
| MessageEditor.tsx | 160 | 单条消息编辑 |
| AttachmentPreview.tsx | 154 | 附件预览 |
| AttachmentModal.tsx | 146 | 附件模态框 |
| ThinkingBlock.tsx | 143 | AI思考展示 |
| ParameterPanel.tsx | 103 | 参数面板 |

**需要关注：**
- `StructuredOutputEditor.tsx` (574行) 较大，可考虑拆分

### 3.3 Evaluation组件 (src/components/Evaluation/)

| 组件 | 行数 | 说明 |
|------|------|------|
| **TestCaseEditor.tsx** | 551 | 测试用例编辑器 |
| EvaluationResultsView.tsx | 348 | 结果展示 |
| CriteriaEditor.tsx | 300 | 评价标准编辑 |
| RunHistory.tsx | 185 | 执行历史 |
| TestCaseList.tsx | 82 | 用例列表 |

**需要关注：**
- `TestCaseEditor.tsx` (551行) 较大

### 3.4 Settings组件 (src/components/Settings/)

| 组件 | 行数 | 说明 |
|------|------|------|
| **DatabaseSettings.tsx** | 578 | 数据库配置 |
| **ProviderForm.tsx** | 500 | 服务商表单 |
| ModelCapabilityTest.tsx | 294 | 模型能力测试 |
| SupabaseUpgradeModal.tsx | 222 | 升级模态框 |
| SupabaseInitModal.tsx | 173 | 初始化模态框 |
| OptimizationSettings.tsx | 123 | 优化设置 |
| AddProviderModal.tsx | 114 | 添加服务商 |
| ProviderList.tsx | 82 | 服务商列表 |

**需要关注：**
- `DatabaseSettings.tsx` (578行) 和 `ProviderForm.tsx` (500行) 较大

---

## 4. 状态管理分析 (src/store/)

| Store | 行数 | 职责 |
|-------|------|------|
| **useEvaluationStore.ts** | 801 | 评测状态管理 |
| **usePromptsStore.ts** | 535 | Prompt状态管理 |
| useTracesStore.ts | 376 | 执行历史状态 |
| selectors.ts | 222 | 状态选择器 |
| useGlobalStore.ts | 131 | 全局状态(providers/models) |
| useUIStore.ts | 116 | UI状态(toast等) |
| index.ts | 38 | 导出入口 |

**问题：**
- `useEvaluationStore.ts` (801行) 过大，包含了业务逻辑
- `usePromptsStore.ts` (535行) 较大

**建议：**
- 将业务逻辑抽取到独立的service层
- Store只负责状态管理，不包含复杂业务逻辑

---

## 5. 工具库分析 (src/lib/)

| 文件 | 行数 | 说明 |
|------|------|------|
| **ai-service.ts** | 1,335 | AI服务集成 |
| file-utils.ts | 249 | 文件处理 |
| schema-utils.ts | 245 | JSON Schema工具 |
| model-capabilities.ts | 234 | 模型能力检测 |
| prompt-analyzer.ts | 94 | Prompt分析 |
| supabase.ts | 7 | Supabase客户端 |

### 数据库抽象层 (src/lib/database/)

| 文件 | 行数 | 说明 |
|------|------|------|
| mysql-adapter.ts | 516 | MySQL适配器 |
| supabase-adapter.ts | 348 | Supabase适配器 |
| supabase-init-sql.ts | 221 | 初始化SQL |
| migrations/001_initial.ts | 376 | 初始迁移 |
| migrations/index.ts | 105 | 迁移管理 |
| index.ts | 97 | 数据库入口 |
| types.ts | 81 | 类型定义 |

**评价：** 数据库抽象层设计良好，支持多数据库切换。

---

## 6. 冗余代码分析

### 6.1 重复的错误处理模式

多处出现类似的try-catch错误处理：
```typescript
try {
  // 操作
} catch (error) {
  showToast(t('errorMessage'), 'error');
  console.error(error);
}
```

**建议：** 创建统一的错误处理Hook
```typescript
// src/hooks/useAsyncOperation.ts
function useAsyncOperation<T>() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const execute = async (operation: () => Promise<T>) => {
    setLoading(true);
    try {
      return await operation();
    } catch (e) {
      setError(e);
      showToast(e.message, 'error');
    } finally {
      setLoading(false);
    }
  };

  return { loading, error, execute };
}
```

### 6.2 重复的文件上传逻辑

文件上传逻辑在以下位置重复：
- `PromptsPage.tsx`
- `TestCaseEditor.tsx`
- `PromptWizardPage.tsx`

**建议：** 创建统一的文件上传Hook
```typescript
// src/hooks/useFileUpload.ts
function useFileUpload(options: FileUploadOptions) {
  // 统一的文件上传逻辑
}
```

### 6.3 重复的模型选择逻辑

模型选择和验证逻辑在多处重复：
- `PromptsPage.tsx`
- `EvaluationPage.tsx`
- `PromptWizardPage.tsx`

**建议：** 已有`ModelSelector`组件，但选择后的处理逻辑可以进一步抽象

### 6.4 重复的数据库操作模式

CRUD操作模式在多个Store中重复：
```typescript
const addItem = async (item) => {
  const { data, error } = await db.from('table').insert(item);
  if (error) throw error;
  set({ items: [...get().items, data] });
};
```

**建议：** 创建通用的数据库操作工厂
```typescript
// src/lib/database/crud-factory.ts
function createCrudOperations<T>(tableName: string) {
  return {
    create: async (item: Partial<T>) => { ... },
    read: async (id: string) => { ... },
    update: async (id: string, item: Partial<T>) => { ... },
    delete: async (id: string) => { ... },
  };
}
```

---

## 7. 高价值复用代码

### 7.1 UI组件库 (src/components/ui/)

**价值：高**

完整的UI组件库，包含：
- Button (多种变体)
- Modal (通用模态框)
- Toast (全局通知)
- Tabs (标签页)
- Select/Input (表单组件)
- ModelSelector (业务组件)

### 7.2 数据库抽象层 (src/lib/database/)

**价值：极高**

支持多数据库的抽象层：
- 统一的API接口
- MySQL和Supabase适配器
- 迁移系统
- 批量查询支持

### 7.3 AI服务层 (src/lib/ai-service.ts)

**价值：极高**

统一的AI服务接口：
- 多模型支持
- 流式响应
- 错误处理
- Token计数

### 7.4 状态管理架构 (src/store/)

**价值：高**

Zustand状态管理：
- 清晰的状态分离
- 选择器优化
- 持久化支持

### 7.5 国际化系统 (src/locales/)

**价值：高**

完整的i18n支持：
- 4种语言 (zh-CN, en, ja, zh-TW)
- 命名空间分离
- AI提示词多语言

---

## 8. 重构建议优先级

### P0 - 紧急

1. **拆分 PromptsPage.tsx** (2,036行)
   - 影响：代码可维护性、开发效率
   - 工作量：中等

2. **拆分 EvaluationPage.tsx** (1,869行)
   - 影响：代码可维护性、开发效率
   - 工作量：中等

### P1 - 重要

3. **创建自定义Hooks目录**
   - `useAsyncOperation` - 异步操作
   - `useFileUpload` - 文件上传
   - `useDatabaseMutation` - 数据库操作
   - 工作量：小

4. **拆分 useEvaluationStore.ts** (801行)
   - 将业务逻辑移至service层
   - 工作量：中等

### P2 - 改进

5. **拆分大型组件**
   - `StructuredOutputEditor.tsx` (574行)
   - `DatabaseSettings.tsx` (578行)
   - `TestCaseEditor.tsx` (551行)
   - 工作量：中等

6. **创建通用CRUD工厂**
   - 减少Store中的重复代码
   - 工作量：小

---

## 9. 代码质量指标

| 指标 | 当前状态 | 目标 |
|------|----------|------|
| 最大文件行数 | 2,036 | < 500 |
| 平均组件行数 | ~200 | < 200 |
| 自定义Hooks数量 | 0 | 5+ |
| 代码重复率 | 中等 | 低 |
| 测试覆盖率 | 未知 | > 60% |

---

## 10. 总结

### 优点
- UI组件设计良好，复用度高
- 数据库抽象层设计优秀
- 国际化支持完整
- 状态管理架构清晰

### 需要改进
- 两个主页面过大，需要拆分
- 缺少自定义Hooks层
- 部分业务逻辑与UI耦合
- 存在重复代码模式

### 下一步行动
1. 创建 `src/hooks/` 目录，提取通用逻辑
2. 拆分 `PromptsPage.tsx` 和 `EvaluationPage.tsx`
3. 将Store中的业务逻辑移至service层
4. 建立代码审查规范，限制文件大小
