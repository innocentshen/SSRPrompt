# PRD v2.2：Prompt 发布流水线（Draft / Review / Release / Rollback）

## 1. 背景与问题

当前 Prompt 编辑与线上生效耦合，存在以下风险：

1. 修改即生效，缺少审核闸门，容易误发布。
2. 版本回滚依赖人工操作，恢复慢且不可审计。
3. 无发布记录链路，难以追溯“谁在何时发布了什么”。
4. 缺少“发布前回归评测”机制，线上质量不稳定。

## 2. 目标

建立标准化发布流水线，实现：

1. 编辑态与线上态解耦：`draft` 不直接影响线上。
2. 发布可审核：支持多人协作与权限分离。
3. 发布可追溯：完整发布单、审批、操作日志。
4. 发布可回滚：一键回滚到历史稳定版本。
5. 发布可验证：可选“发布前必须通过回归评测”。

## 3. 非目标（本期不做）

1. 不做跨项目多环境（dev/staging/prod）一体化编排。
2. 不做复杂审批流引擎（如多级会签、条件分支）。
3. 不改造模型供应商侧能力，仅管理 Prompt 发布过程。

## 4. 核心角色与权限

1. `Editor`：可编辑 draft、提交发布候选。
2. `Reviewer`：可审核发布候选（通过/拒绝）。
3. `Publisher`：可执行发布与回滚。
4. `Admin`：具备全权限，可配置发布策略。

权限原则：最小权限。`Editor` 默认不能直接发布。

## 5. 用户故事

1. 作为编辑者，我希望先在 draft 中迭代，不影响线上调用。
2. 作为审核者，我希望对候选版本查看 diff、评测结果再决定是否通过。
3. 作为发布者，我希望一键发布，并自动记录发布日志。
4. 作为值班人员，我希望线上异常时可以一键回滚到上一个稳定版本。

## 6. 业务流程

### 6.1 提交流程

1. 编辑者在 Prompt 工作区修改 draft。
2. 点击“创建发布候选（Release Candidate）”。
3. 系统冻结候选快照（messages/config/variables/model/output schema）。
4. 若开启发布门禁，自动执行回归评测任务。
5. 评测达标后进入待审核队列。
6. 审核通过后，由发布者执行“发布”。
7. 发布成功后更新线上绑定版本，并记录 release event。

### 6.2 回滚流程

1. 发布者在发布历史中选择一个已发布版本。
2. 执行“回滚到该版本”。
3. 系统创建 rollback event，并更新线上绑定版本。
4. 保留原发布链路与回滚审计记录。

## 7. 状态机设计

### 7.1 Candidate 状态

`draft -> candidate_pending_review -> candidate_rejected -> candidate_approved -> released -> superseded`

### 7.2 Release 事件

`release_created / release_approved / release_published / release_rolled_back / release_canceled`

## 8. 数据模型（建议）

### 8.1 `prompt_release_candidates`

1. `id`
2. `prompt_id`
3. `source_version`
4. `snapshot_json`（冻结内容）
5. `status`
6. `created_by`
7. `approved_by` / `approved_at`
8. `rejected_reason`
9. `evaluation_run_id`（可选，关联回归评测）
10. `created_at` / `updated_at`

### 8.2 `prompt_releases`

1. `id`
2. `prompt_id`
3. `candidate_id`
4. `released_version`
5. `released_by`
6. `released_at`
7. `is_active`
8. `rollback_from_release_id`（可选）

### 8.3 `prompt_release_events`

1. `id`
2. `prompt_id`
3. `candidate_id`（可选）
4. `release_id`（可选）
5. `event_type`
6. `operator_user_id`
7. `payload_json`
8. `created_at`

## 9. API 设计（草案）

1. `POST /api/v1/prompts/:promptId/release-candidates`
2. `GET /api/v1/prompts/:promptId/release-candidates`
3. `POST /api/v1/prompts/:promptId/release-candidates/:candidateId/approve`
4. `POST /api/v1/prompts/:promptId/release-candidates/:candidateId/reject`
5. `POST /api/v1/prompts/:promptId/releases/publish`
6. `POST /api/v1/prompts/:promptId/releases/:releaseId/rollback`
7. `GET /api/v1/prompts/:promptId/releases`
8. `GET /api/v1/prompts/:promptId/release-events`

## 10. 前端改造（草案）

在 `PromptsPage` 新增“发布中心”模块：

1. 候选列表：状态、提交人、提交时间、评测结果。
2. 候选详情：与当前线上版本 diff。
3. 审核操作：通过/拒绝（含原因）。
4. 发布记录：版本号、发布时间、操作人、回滚按钮。
5. 风险提示：发布将影响 Prompt API `latest` 调用。

## 11. 发布门禁策略

可配置策略项：

1. 是否必须审核后发布（默认是）。
2. 是否必须通过回归评测（默认是，阈值可配置）。
3. 失败重试策略与超时策略。
4. 是否允许紧急发布（需要更高权限并写入审计）。

## 12. 兼容性与影响

1. `apiVersionMode=latest`：发布后自动指向新的 active release。
2. `apiVersionMode=fixed`：保持固定版本，不受新发布影响。
3. 旧 Prompt 版本机制继续保留，发布流水线在其上增加“上线治理”层。

## 13. 监控与审计

核心指标：

1. 发布成功率
2. 审核平均时长
3. 发布后回滚率
4. 回归评测通过率

审计日志必须记录：

1. 操作者
2. 操作类型
3. 影响对象（prompt/candidate/release）
4. 时间与上下文 payload

## 14. 验收标准（DoD）

1. Draft 编辑不影响线上调用结果。
2. 任何发布都可追溯到候选快照与审批记录。
3. 任何已发布版本可在 1 分钟内回滚。
4. 开启门禁时，未通过评测的候选不能发布。
5. 权限控制生效：无权角色无法执行审核/发布/回滚。

## 15. 里程碑建议

1. M1（1 周）：数据模型 + API 骨架 + 审计事件。
2. M2（1 周）：前端发布中心 + 审核流。
3. M3（1 周）：发布门禁（评测集成）+ 回滚能力。
4. M4（0.5 周）：灰度验证 + 文档 + 运维手册。
