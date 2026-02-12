# PRD：评测集批量导入（Excel + ZIP 附件）

> 目标：支持通过“上传一个 ZIP 包”的方式，批量导入评测集（Evaluation），包含 TestCases、Criteria、运行配置（config），并支持附件从 ZIP 内文件或公开 URL 加载后转存到 MinIO/文件表，最终在评测用例中以 `fileId` 引用。

## 1. 背景与问题

当前评测集通常通过 UI 逐条创建用例、逐个上传附件。对于大量用例/附件的场景成本很高；同时附件需要统一进入文件服务（MinIO），以便 OCR/预览/下载等能力复用。

## 2. 目标（Goals）

### 2.1 必做
- 支持上传一个 ZIP 包导入评测集数据与附件：
  - `import.xlsx`：包含评测集元信息、Criteria、TestCases（含附件引用）
  - `attachments/...`：附件文件（可选，但推荐放在此目录下）
- TestCases 的附件引用支持混合：
  - ZIP 内路径（相对 ZIP 根路径）
  - 公开 URL（仅 `http/https`，不支持鉴权 Header/Cookie）
- 支持导入到已有评测集：
  - `append`：追加用例/合并标准（建议按 name merge）
  - `overwrite`：覆盖（必须删除历史 runs/results，并重置评测集状态）
- 限制与容错：
  - 单个附件大小上限沿用 20MB
  - 允许部分失败：某行/某附件失败，继续处理后续行/后续附件，并输出失败明细

### 2.2 体验目标
- 导入过程可观察：提供进度与错误报告（行级/附件级）。
- 导入完成可直接打开导入后的评测集继续运行评测。

## 3. 非目标（Non-Goals）
- 不支持需要鉴权的 URL 下载（如自定义 Header/Cookie、登录态等）。
- 不做“视觉模型文件直传”的额外链路改造（导入后仍沿用现有 runner 的文件处理逻辑）。
- 不要求 ZIP 必须包含所有附件（可全 URL，或混合）。

## 4. ZIP 包规范

### 4.1 必须包含
- 一个 `import.xlsx`（文件名必须为 `import.xlsx`，推荐放在 ZIP 根目录）

### 4.2 推荐结构
```
evaluation-import.zip
├─ import.xlsx
└─ attachments/
   ├─ case-001/contract.pdf
   ├─ case-001/screenshot.png
   └─ shared/spec.md
```

### 4.3 ZIP 内路径规则（供 Excel 引用）
- 统一使用 `/` 分隔符（允许用户输入 `\\`，服务端会归一化为 `/`）。
- 仅允许相对路径（不得以 `/` 开头）。
- 禁止路径穿越（不得包含 `..` 片段）。
- 路径大小写：建议按原样匹配；实现上可选“大小写不敏感查找”作为增强。

## 5. Excel（import.xlsx）规范

### 5.1 工作簿 Sheet 约定
- 约定 3 个 Sheet（大小写不敏感）：
  - `Meta`：评测集级别元信息（1 行）
  - `Criteria`：评分标准（0..N 行）
  - `TestCases`：测试用例（1..N 行）

> 如果缺失某个 Sheet：按空处理（Meta 缺失则视为所有字段未设置；Criteria/TestCases 缺失则当作空列表）。

### 5.2 表头与字段定义

#### 5.2.1 Meta（1 行）
| 列名 | 必填 | 类型 | 示例 | 说明 |
|---|---:|---|---|---|
| evaluationName | create 必填 | string | 我的评测集 | `append/overwrite` 时可选，用于重命名 |
| promptId | 否 | uuid | ... | 可空；不可访问时：导入时置空并记录 warning |
| modelId | 否 | uuid | ... | 可空；不可访问时：置空并记录 warning |
| judgeModelId | 否 | uuid | ... | 可空；不可访问时：置空并记录 warning |
| pass_threshold | 否 | number | 0.6 | 支持 0..1；兼容 6(表示6/10)、60(表示60%) 的输入（实现建议） |
| execution_mode | 否 | enum | sequential | `sequential` / `parallel` |
| file_processing | 否 | enum | auto | `auto` / `vision` / `ocr` / `none` |
| ocr_provider | 否 | enum | paddle | 取值同系统 OCR provider 枚举 |
| model_parameters_json | 否 | json string | {"temperature":0.2} | 对应 `config.model_parameters` |

#### 5.2.2 Criteria（0..N 行）
| 列名 | 必填 | 类型 | 示例 |
|---|---:|---|---|
| name | 是 | string | 准确性 |
| description | 否 | string | ... |
| prompt | 否 | string | ... |
| weight | 否 | number | 1 |
| enabled | 否 | boolean | true |

> `append` 模式建议按 `name` merge：同名则 update，否则 create；`overwrite` 模式则清空重建。

#### 5.2.3 TestCases（1..N 行）
| 列名 | 必填 | 类型 | 示例 | 说明 |
|---|---:|---|---|---|
| name | 否 | string | 用例1 | 为空则允许，UI 可显示“用例#n” |
| inputText | 否 | string | ... | 为空允许 |
| expectedOutput | 否 | string | ... | 为空允许 |
| notes | 否 | string | ... | 为空允许 |
| inputVariables_json | 否 | json string | {"lang":"zh"} | 解析失败：该行失败并继续下一行 |
| attachments | 否 | string | `attachments/c1/a.pdf;https://x/b.png` | 混合列，`;` 分隔；每项要么是 ZIP 路径，要么是公开 URL |
| attachmentNames | 否 | string | `a.pdf;b.png` | 与 `attachments` 一一对应（可短于 attachments） |
| attachmentTypes | 否 | string | `application/pdf;image/png` | 与 `attachments` 一一对应（可短于 attachments） |

### 5.3 附件引用识别规则（attachments 列）
- 若项以 `http://` 或 `https://` 开头：视为 URL
- 否则：视为 ZIP 内路径（相对 ZIP 根目录）

### 5.4 推荐的分隔与转义
- 附件引用列表默认用 `;` 分隔（前后空白会被 trim）
- 约定不支持在单个附件项内出现 `;`（若有需求，后续可升级为 CSV/JSON 列）

## 6. 后端行为与逻辑

### 6.1 导入模式
- `create`：创建新评测集
  - 必须提供 `evaluationName`
  - 默认：`isPublic=false`、`shareAttachments=false`
- `append`：导入到已有评测集（必须是 owner）
  - TestCases：按 Excel 顺序追加到末尾（自动递增 orderIndex）
  - Criteria：建议按 name merge（见 5.2.2）
  - Meta：仅覆盖 Excel 中非空字段
- `overwrite`：覆盖已有评测集（必须是 owner）
  - 必须先删除历史：`TestCaseResult`、`EvaluationRun`
  - 必须清空并重建：`TestCase`、`EvaluationCriterion`
  - 必须重置评测集：`status=pending`、`results={}`、`completedAt=null`、`isPublic=false`、`shareAttachments=false`

### 6.2 附件转存（ZIP/URL 一致）
- 每个附件最终都要转存为文件服务记录：
  - 上传至 MinIO/S3
  - 在 `files`（StoredFile）表建记录，得到 `fileId`
  - 写回到用例的 `attachments` JSON：`[{ fileId, name, type, size }]`

### 6.3 限额与容错（必须）
- 单文件大小上限：20MB（超限：该附件失败，继续）
- 允许部分失败：
  - 行校验失败：该行失败并跳过，继续下一行
  - 附件失败：该附件跳过，继续该行下一个附件；该用例仍导入

### 6.4 URL 下载安全（必须）
- 仅允许 `http/https`
- SSRF 防护（建议）：
  - 禁止访问 localhost/内网/保留地址段（IPv4/IPv6）
  - 限制重定向次数（例如 ≤3），每次重定向后的目标都要重新校验
  - 强制超时（例如 10–20s）
  - 强制响应体大小上限（20MB；优先基于 Content-Length 预判）

### 6.5 ZIP 安全（建议）
- Zip Slip 防护：拒绝包含 `../`、绝对路径、盘符路径的 entry
- Zip Bomb 防护：建议限制：
  - entry 数量上限
  - 单 entry 解压后大小上限（附件 20MB、xlsx 例如 10MB）
  - 总解压后大小上限（例如 200MB，可配置）

## 7. 接口（API）建议

> 建议异步导入：避免 ZIP 解析 + 多 URL 下载导致请求超时。

### 7.1 创建导入任务
- `POST /api/v1/evaluation-imports/zip`
- `multipart/form-data`
  - `file`: ZIP 文件
  - `mode`: `create|append|overwrite`
  - `targetEvaluationId`：`append/overwrite` 必填
- Response
  - `{ data: { jobId } }`

### 7.2 查询进度/结果
- `GET /api/v1/evaluation-imports/:jobId`
- Response
  - `{ data: { status, mode, targetEvaluationId, resultEvaluationId, progress, errors[] } }`

### 7.3 错误报告（可选增强）
- `GET /api/v1/evaluation-imports/:jobId/report`
  - 下载 CSV/JSON 失败清单（便于排查与二次导入）

## 8. 数据库（建议新增表）

### 8.1 EvaluationImportJob
- `id`、`userId`
- `status`: `pending|running|completed|failed`
- `mode`: `create|append|overwrite`
- `targetEvaluationId?`、`resultEvaluationId?`
- `sourceZipFileId`：上传 ZIP 后转存到文件表的 fileId（便于 worker 拉取）
- `progress`：
  - `totalRows, processedRows, successRows, failedRows`
  - `totalAttachments, successAttachments, failedAttachments`
- `errorsJson`：错误列表（建议上限 N 条并标记截断）
- `createdAt, completedAt`

## 9. Worker/队列建议
- 与现有 `evaluation.run` 同类：
  - `evaluation.import` 任务：payload `{ jobId }`
  - 支持两种 driver：
    - `pg`：graphile-worker
    - `memory`：进程内队列（开发模式可用，但重启会丢任务）

## 10. 前端交互建议（v1）
- 入口：评测中心列表页新增“导入”
- 弹窗流程：
  1) 选择导入目标：新建 / 当前评测集（或选择已有）
  2) 选择模式：追加 / 覆盖
  3) 上传 ZIP
  4) 展示进度 + 失败数 + 失败明细（可复制/下载）
  5) 完成后跳转到结果评测集

## 11. 测试与验收

### 11.1 用例
- create + ZIP 内附件路径导入成功
- create + URL 附件导入成功
- create + 混合附件导入成功
- append：用例追加，orderIndex 正确递增；标准按 name merge
- overwrite：历史 runs/results 被删除；评测集 status 重置为 pending；用例/标准完全覆盖
- 部分失败：单个附件超 20MB / URL 404 / ZIP 路径不存在 → 记录失败但导入继续

### 11.2 安全
- URL SSRF：拒绝访问内网/localhost；重定向到内网也要拒绝
- ZIP Slip：`../` entry 必须拒绝
- 大包/zip bomb：触发限制时任务失败并给出明确错误

## 12. 里程碑建议
- M1：后端 ZIP+Excel 解析、create 导入、ZIP 附件转存
- M2：append/overwrite、错误报告、进度查询
- M3：URL 下载 + SSRF、前端导入 UI、模板下载/示例

