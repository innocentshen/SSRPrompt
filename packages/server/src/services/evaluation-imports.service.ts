import { prisma } from '../config/database.js';
import { AppError } from '@ssrprompt/shared';
import { filesService } from './files.service.js';
import type { Prisma } from '@prisma/client';
import * as XLSX from 'xlsx';
import { zipSync } from 'fflate';
import { lookup as mimeLookup } from 'mime-types';
import { ZipReader, type ZipReaderLimits } from '../utils/zip-reader.js';
import { downloadPublicUrl } from '../utils/public-download.js';

export type EvaluationImportMode = 'create' | 'append' | 'overwrite';
export type EvaluationImportJobStatus = 'pending' | 'running' | 'completed' | 'failed';
export type EvaluationImportLocale = 'en' | 'zh-CN' | 'zh-TW' | 'ja';

type ImportProgress = {
  stage: string;
  totalRows: number;
  processedRows: number;
  successRows: number;
  failedRows: number;
  totalAttachments: number;
  successAttachments: number;
  failedAttachments: number;
  errorsTruncated?: boolean;
};

type ImportError = {
  scope: 'zip' | 'excel' | 'meta' | 'criteria' | 'row' | 'attachment';
  sheet?: 'Meta' | 'Criteria' | 'TestCases';
  row?: number; // 1-based row index in Excel (including header row)
  testCaseName?: string;
  ref?: string; // attachment ref (zip path or URL)
  code: string;
  message: string;
};

type ParsedMeta = {
  evaluationName?: string;
  promptId?: string;
  modelId?: string;
  judgeModelId?: string;
  configPatch: Record<string, unknown>;
};

type ParsedCriterion = {
  name: string;
  description?: string;
  prompt?: string;
  weight?: number;
  enabled?: boolean;
};

type ParsedAttachmentRef = {
  ref: string;
  nameHint?: string;
  typeHint?: string;
};

type ParsedTestCase = {
  rowNumber: number;
  name?: string;
  inputText: string;
  expectedOutput?: string;
  notes?: string;
  inputVariables: Record<string, unknown>;
  attachments: ParsedAttachmentRef[];
};

type ParsedExcelImport = {
  meta: ParsedMeta;
  criteria: ParsedCriterion[];
  testCases: ParsedTestCase[];
  errors: ImportError[];
};

const DEFAULT_MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024; // 20MB
const DEFAULT_MAX_XLSX_BYTES = 10 * 1024 * 1024; // 10MB
const IMPORT_TEMPLATE_VERSION = 'v1';
const DEFAULT_IMPORT_LOCALE: EvaluationImportLocale = 'en';

type StoredAttachment = {
  fileId: string;
  name: string;
  type: string;
  size?: number;
};

export function normalizeEvaluationImportLocale(input?: string | null): EvaluationImportLocale {
  const raw = String(input ?? '').trim().toLowerCase();
  if (!raw) return DEFAULT_IMPORT_LOCALE;

  const primary = raw.split(',')[0]?.split(';')[0]?.trim() ?? '';
  if (!primary) return DEFAULT_IMPORT_LOCALE;

  if (
    primary === 'zh-tw' ||
    primary === 'zh-hk' ||
    primary === 'zh-mo' ||
    primary === 'zh-hant' ||
    primary.startsWith('zh-tw') ||
    primary.startsWith('zh-hk') ||
    primary.startsWith('zh-mo') ||
    primary.startsWith('zh-hant')
  ) {
    return 'zh-TW';
  }

  if (
    primary === 'zh' ||
    primary === 'zh-cn' ||
    primary === 'zh-sg' ||
    primary === 'zh-hans' ||
    primary.startsWith('zh-cn') ||
    primary.startsWith('zh-sg') ||
    primary.startsWith('zh-hans')
  ) {
    return 'zh-CN';
  }

  if (primary === 'ja' || primary === 'ja-jp' || primary.startsWith('ja')) {
    return 'ja';
  }

  return 'en';
}

function getNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = typeof value === 'number' ? value : Number(String(value).trim());
  return Number.isFinite(n) ? n : null;
}

function getString(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

function getOptionalString(value: unknown): string | undefined {
  const v = getString(value);
  return v ? v : undefined;
}

function splitSemicolon(value: unknown): string[] {
  const raw = getString(value);
  if (!raw) return [];
  return raw
    .split(';')
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizePassThreshold(value: unknown): number | undefined {
  const n = getNumber(value);
  if (n === null) return undefined;

  // UI uses 0..1, but users may type 6(=0.6) or 60(=0.6).
  let normalized = n;
  if (normalized > 1 && normalized <= 10) normalized = normalized / 10;
  else if (normalized > 10 && normalized <= 100) normalized = normalized / 100;

  if (normalized < 0) normalized = 0;
  if (normalized > 1) normalized = 1;
  return normalized;
}

function normalizeZipRef(value: string): string {
  return value.trim().replace(/\\/g, '/').replace(/^\.\//, '');
}

function isPublicHttpUrl(value: string): boolean {
  return /^https?:\/\//i.test(value.trim());
}

function guessMimeTypeFromName(filename: string): string {
  const lookedUp = mimeLookup(filename);
  if (typeof lookedUp === 'string' && lookedUp) return lookedUp;
  return 'application/octet-stream';
}

function basename(pathValue: string): string {
  const normalized = pathValue.replace(/\\/g, '/');
  const last = normalized.split('/').filter(Boolean).pop();
  return last || 'file';
}

function sanitizePathPart(value: string, fallback: string): string {
  const normalized = String(value || '')
    .replace(/[\\/:*?"<>|]+/g, '_')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');
  return normalized || fallback;
}

function safeJsonString(value: unknown): string {
  if (value === null || value === undefined) return '';
  try {
    return JSON.stringify(value);
  } catch {
    return '';
  }
}

function isStoredAttachments(value: unknown): value is StoredAttachment[] {
  if (!Array.isArray(value)) return false;
  return value.every((item) => {
    if (!item || typeof item !== 'object') return false;
    const record = item as Record<string, unknown>;
    return (
      typeof record.fileId === 'string' &&
      typeof record.name === 'string' &&
      typeof record.type === 'string'
    );
  });
}

function buildImportWorkbookBuffer(input: {
  meta: Record<string, unknown>;
  criteria: Array<Record<string, unknown>>;
  testCases: Array<Record<string, unknown>>;
}): Buffer {
  const workbook = XLSX.utils.book_new();

  const metaSheet = XLSX.utils.json_to_sheet([input.meta], {
    header: [
      'evaluationName',
      'promptId',
      'modelId',
      'judgeModelId',
      'pass_threshold',
      'file_processing',
      'ocr_provider',
      'model_parameters_json',
    ],
  });
  const criteriaSheet = XLSX.utils.json_to_sheet(input.criteria, {
    header: ['name', 'description', 'prompt', 'weight', 'enabled'],
  });
  const testCasesSheet = XLSX.utils.json_to_sheet(input.testCases, {
    header: [
      'name',
      'inputText',
      'inputVariables_json',
      'attachments',
      'attachmentNames',
      'attachmentTypes',
      'expectedOutput',
      'notes',
    ],
  });

  XLSX.utils.book_append_sheet(workbook, metaSheet, 'Meta');
  XLSX.utils.book_append_sheet(workbook, criteriaSheet, 'Criteria');
  XLSX.utils.book_append_sheet(workbook, testCasesSheet, 'TestCases');

  const wbBuffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
  return Buffer.isBuffer(wbBuffer) ? wbBuffer : Buffer.from(wbBuffer);
}

function buildTemplateReadmeText(locale: EvaluationImportLocale): string {
  if (locale === 'zh-CN') {
    return [
      '# 评测 ZIP 导入模板',
      '',
      `版本：${IMPORT_TEMPLATE_VERSION}`,
      '',
      'ZIP 结构：',
      '- import.xlsx（必填）',
      '- attachments/...（可选）',
      '',
      '工作表：Meta（使用第 2 行）',
      '- evaluationName：create 模式必填',
      '- promptId/modelId/judgeModelId：可选 UUID',
      '- pass_threshold：0~1，也支持 6(0.6)/60(0.6)',
      '- file_processing：auto | vision | ocr | none',
      '- ocr_provider：可选 OCR 供应商编码',
      '- model_parameters_json：JSON 对象字符串',
      '',
      '工作表：Criteria',
      '- name：必填',
      '- description/prompt：可选',
      '- weight：数字，默认 1',
      '- enabled：true/false，默认 true',
      '',
      '工作表：TestCases',
      '- name/inputText/expectedOutput/notes',
      '- inputVariables_json：JSON 对象字符串',
      '- attachments：分号分隔引用（ZIP 相对路径或公网 URL）',
      '- attachmentNames / attachmentTypes：可选提示，分号分隔',
      '',
      '说明：',
      '- 为兼容解析器，工作表名和列名需保持模板原样，不要改名。',
      '- attachmentNames/attachmentTypes 与 attachments 按索引一一对应。',
      '- append 模式按 Criteria.name 进行更新/新增。',
      '- overwrite 模式会重置原有执行记录/结果/用例/评分标准。',
      '',
    ].join('\n');
  }

  if (locale === 'zh-TW') {
    return [
      '# 評測 ZIP 匯入模板',
      '',
      `版本：${IMPORT_TEMPLATE_VERSION}`,
      '',
      'ZIP 結構：',
      '- import.xlsx（必填）',
      '- attachments/...（可選）',
      '',
      '工作表：Meta（使用第 2 行）',
      '- evaluationName：create 模式必填',
      '- promptId/modelId/judgeModelId：可選 UUID',
      '- pass_threshold：0~1，也支援 6(0.6)/60(0.6)',
      '- file_processing：auto | vision | ocr | none',
      '- ocr_provider：可選 OCR 供應商代碼',
      '- model_parameters_json：JSON 物件字串',
      '',
      '工作表：Criteria',
      '- name：必填',
      '- description/prompt：可選',
      '- weight：數字，預設 1',
      '- enabled：true/false，預設 true',
      '',
      '工作表：TestCases',
      '- name/inputText/expectedOutput/notes',
      '- inputVariables_json：JSON 物件字串',
      '- attachments：以分號分隔引用（ZIP 相對路徑或公開 URL）',
      '- attachmentNames / attachmentTypes：可選提示，以分號分隔',
      '',
      '說明：',
      '- 為了相容解析器，工作表名稱與欄位名稱請保持模板原樣，不要改名。',
      '- attachmentNames/attachmentTypes 與 attachments 需按索引一一對應。',
      '- append 模式會依 Criteria.name 進行更新/新增。',
      '- overwrite 模式會重置原有執行紀錄/結果/用例/評分標準。',
      '',
    ].join('\n');
  }

  if (locale === 'ja') {
    return [
      '# 評価 ZIP インポートテンプレート',
      '',
      `バージョン: ${IMPORT_TEMPLATE_VERSION}`,
      '',
      'ZIP 構成:',
      '- import.xlsx（必須）',
      '- attachments/...（任意）',
      '',
      'シート: Meta（2 行目を使用）',
      '- evaluationName: create モードで必須',
      '- promptId/modelId/judgeModelId: 任意 UUID',
      '- pass_threshold: 0~1（6=0.6、60=0.6 も可）',
      '- file_processing: auto | vision | ocr | none',
      '- ocr_provider: 任意の OCR プロバイダコード',
      '- model_parameters_json: JSON オブジェクト文字列',
      '',
      'シート: Criteria',
      '- name: 必須',
      '- description/prompt: 任意',
      '- weight: 数値（既定 1）',
      '- enabled: true/false（既定 true）',
      '',
      'シート: TestCases',
      '- name/inputText/expectedOutput/notes',
      '- inputVariables_json: JSON オブジェクト文字列',
      '- attachments: セミコロン区切り参照（ZIP 相対パス or 公開 URL）',
      '- attachmentNames / attachmentTypes: 任意ヒント（セミコロン区切り）',
      '',
      '補足:',
      '- パーサ互換のため、シート名と列名はテンプレートのまま変更しないでください。',
      '- attachmentNames/attachmentTypes は attachments と同じ順序で対応させてください。',
      '- append モードでは Criteria.name で更新/追加されます。',
      '- overwrite モードでは既存の実行/結果/ケース/基準がリセットされます。',
      '',
    ].join('\n');
  }

  return [
    '# Evaluation ZIP Import Template',
    '',
    `Version: ${IMPORT_TEMPLATE_VERSION}`,
    '',
    'ZIP structure:',
    '- import.xlsx (required)',
    '- attachments/... (optional)',
    '',
    'Sheet: Meta (row 2 is used)',
    '- evaluationName: required in create mode',
    '- promptId/modelId/judgeModelId: optional UUID',
    '- pass_threshold: 0~1, also accepts 6(0.6)/60(0.6)',
    '- file_processing: auto | vision | ocr | none',
    '- ocr_provider: optional provider code',
    '- model_parameters_json: JSON object string',
    '',
    'Sheet: Criteria',
    '- name: required',
    '- description/prompt: optional',
    '- weight: number, default 1',
    '- enabled: true/false, default true',
    '',
    'Sheet: TestCases',
    '- name/inputText/expectedOutput/notes',
    '- inputVariables_json: JSON object string',
    '- attachments: semicolon-separated refs (ZIP relative path or public URL)',
    '- attachmentNames / attachmentTypes: optional hints, semicolon-separated',
    '',
    'Tips:',
    '- Keep sheet names and column headers unchanged for parser compatibility.',
    '- Keep attachment refs aligned by index with attachmentNames/attachmentTypes.',
    '- In append mode, criteria are upserted by criterion name.',
    '- In overwrite mode, existing runs/results/cases/criteria are reset.',
    '',
  ].join('\n');
}

function buildTemplateWorkbookBuffer(locale: EvaluationImportLocale): Buffer {
  const sample =
    locale === 'zh-CN'
      ? {
          evaluationName: '示例评测',
          criterion1Name: '准确性',
          criterion1Desc: '输出需要事实正确，并与期望结果一致。',
          criterion2Name: '完整性',
          criterion2Desc: '输出应覆盖所有必需字段。',
          caseName: '示例用例 1',
          inputText: '请解析这份采购订单 PDF。',
          expectedOutput: '{"status":"ok"}',
          notes: '可替换为你的真实数据。',
          attachmentContent: '这是导入模板的示例附件内容。',
        }
      : locale === 'zh-TW'
        ? {
            evaluationName: '示例評測',
            criterion1Name: '準確性',
            criterion1Desc: '輸出需事實正確，並與期望結果一致。',
            criterion2Name: '完整性',
            criterion2Desc: '輸出應覆蓋所有必填欄位。',
            caseName: '示例用例 1',
            inputText: '請解析這份採購訂單 PDF。',
            expectedOutput: '{"status":"ok"}',
            notes: '可替換為你的真實資料。',
            attachmentContent: '這是匯入模板的示例附件內容。',
          }
        : locale === 'ja'
          ? {
              evaluationName: 'サンプル評価',
              criterion1Name: '正確性',
              criterion1Desc: '出力は事実として正しく、期待結果に整合している必要があります。',
              criterion2Name: '網羅性',
              criterion2Desc: '出力は必須項目をすべて含む必要があります。',
              caseName: 'サンプルケース 1',
              inputText: 'この発注書 PDF を解析してください。',
              expectedOutput: '{"status":"ok"}',
              notes: '実データに置き換えてください。',
              attachmentContent: 'これはインポートテンプレートのサンプル添付内容です。',
            }
          : {
              evaluationName: 'Sample Evaluation',
              criterion1Name: 'Accuracy',
              criterion1Desc: 'Output should be factually correct and aligned with expected result.',
              criterion2Name: 'Completeness',
              criterion2Desc: 'Output should cover all required fields.',
              caseName: 'Case 1',
              inputText: 'Parse this purchase order PDF.',
              expectedOutput: '{"status":"ok"}',
              notes: 'Replace with your own data.',
              attachmentContent: 'Sample attachment content for import reference.',
            };

  return buildImportWorkbookBuffer({
    meta: {
      evaluationName: sample.evaluationName,
      promptId: '',
      modelId: '',
      judgeModelId: '',
      pass_threshold: 0.6,
      file_processing: 'auto',
      ocr_provider: '',
      model_parameters_json: '{"temperature":0.3,"max_tokens":1024}',
    },
    criteria: [
      {
        name: sample.criterion1Name,
        description: sample.criterion1Desc,
        prompt: '',
        weight: 1,
        enabled: true,
      },
      {
        name: sample.criterion2Name,
        description: sample.criterion2Desc,
        prompt: '',
        weight: 1,
        enabled: true,
      },
    ],
    testCases: [
      {
        name: sample.caseName,
        inputText: sample.inputText,
        inputVariables_json: '{}',
        attachments: 'attachments/sample.txt',
        attachmentNames: 'sample.txt',
        attachmentTypes: 'text/plain',
        expectedOutput: sample.expectedOutput,
        notes: sample.notes,
      },
    ],
  });
}

function buildTemplateSampleAttachmentContent(locale: EvaluationImportLocale): string {
  if (locale === 'zh-CN') return '这是导入模板的示例附件内容。';
  if (locale === 'zh-TW') return '這是匯入模板的示例附件內容。';
  if (locale === 'ja') return 'これはインポートテンプレートのサンプル添付内容です。';
  return 'Sample attachment content for import reference.';
}

function formatAttachmentExportWarning(
  locale: EvaluationImportLocale,
  input: { testCaseName: string; testCaseId: string; fileName: string; fileId: string; reason: string }
): string {
  if (locale === 'zh-CN') {
    return `附件导出失败 [用例=${input.testCaseName || input.testCaseId}, 文件=${input.fileName}, id=${input.fileId}]：${input.reason}`;
  }
  if (locale === 'zh-TW') {
    return `附件匯出失敗 [用例=${input.testCaseName || input.testCaseId}, 檔案=${input.fileName}, id=${input.fileId}]：${input.reason}`;
  }
  if (locale === 'ja') {
    return `添付ファイルのエクスポート失敗 [ケース=${input.testCaseName || input.testCaseId}, ファイル=${input.fileName}, id=${input.fileId}]: ${input.reason}`;
  }
  return `Failed to export attachment [case=${input.testCaseName || input.testCaseId}, file=${input.fileName}, id=${input.fileId}]: ${input.reason}`;
}

function buildExportReadmeText(
  locale: EvaluationImportLocale,
  input: {
    evaluationName: string;
    evaluationId: string;
    exportedAtIso: string;
    includeAttachments: boolean;
    warnings: string[];
  }
): string {
  const yesNo = input.includeAttachments
    ? locale === 'zh-CN'
      ? '是'
      : locale === 'zh-TW'
        ? '是'
        : locale === 'ja'
          ? 'はい'
          : 'yes'
    : locale === 'zh-CN'
      ? '否'
      : locale === 'zh-TW'
        ? '否'
        : locale === 'ja'
          ? 'いいえ'
          : 'no';

  const headerLines =
    locale === 'zh-CN'
      ? [
          '# 评测集导出',
          '',
          `评测名称：${input.evaluationName}`,
          `评测 ID：${input.evaluationId}`,
          `导出时间：${input.exportedAtIso}`,
          `包含附件：${yesNo}`,
          '',
        ]
      : locale === 'zh-TW'
        ? [
            '# 評測集匯出',
            '',
            `評測名稱：${input.evaluationName}`,
            `評測 ID：${input.evaluationId}`,
            `匯出時間：${input.exportedAtIso}`,
            `包含附件：${yesNo}`,
            '',
          ]
        : locale === 'ja'
          ? [
              '# 評価セット エクスポート',
              '',
              `評価名: ${input.evaluationName}`,
              `評価 ID: ${input.evaluationId}`,
              `エクスポート日時: ${input.exportedAtIso}`,
              `添付を含む: ${yesNo}`,
              '',
            ]
          : [
              '# Evaluation Export',
              '',
              `Evaluation: ${input.evaluationName}`,
              `Evaluation ID: ${input.evaluationId}`,
              `Exported At: ${input.exportedAtIso}`,
              `Include Attachments: ${yesNo}`,
              '',
            ];

  if (input.warnings.length === 0) {
    return headerLines.join('\n');
  }

  const warningsTitle =
    locale === 'zh-CN' ? '## 警告' : locale === 'zh-TW' ? '## 警告' : locale === 'ja' ? '## 警告' : '## Warnings';
  const warningLines = input.warnings.map((line) => `- ${line}`);
  return [...headerLines, warningsTitle, ...warningLines, ''].join('\n');
}

function parseMetaRow(row: Record<string, unknown>, errors: ImportError[]): ParsedMeta {
  const evaluationName = getOptionalString(row.evaluationName);
  const promptId = getOptionalString(row.promptId);
  const modelId = getOptionalString(row.modelId);
  const judgeModelId = getOptionalString(row.judgeModelId);

  const configPatch: Record<string, unknown> = {};

  const passThreshold = normalizePassThreshold(row.pass_threshold);
  if (passThreshold !== undefined) configPatch.pass_threshold = passThreshold;

  const fileProcessing = getOptionalString(row.file_processing);
  if (fileProcessing) configPatch.file_processing = fileProcessing;

  const ocrProvider = getOptionalString(row.ocr_provider);
  if (ocrProvider) configPatch.ocr_provider = ocrProvider;

  const modelParamsRaw = getOptionalString(row.model_parameters_json);
  if (modelParamsRaw) {
    try {
      const parsed = JSON.parse(modelParamsRaw) as unknown;
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('model_parameters_json must be an object');
      }
      configPatch.model_parameters = parsed;
    } catch (error) {
      errors.push({
        scope: 'meta',
        sheet: 'Meta',
        row: 2,
        code: 'INVALID_MODEL_PARAMETERS_JSON',
        message: (error as Error).message,
      });
    }
  }

  return { evaluationName, promptId, modelId, judgeModelId, configPatch };
}

function parseCriteriaRows(rows: Array<Record<string, unknown>>): ParsedCriterion[] {
  const criteria: ParsedCriterion[] = [];
  rows.forEach((row) => {
    const name = getOptionalString(row.name);
    if (!name) {
      // allow empty trailing rows; treat as skip
      return;
    }

    const weight = getNumber(row.weight);
    const enabledRaw = row.enabled;
    const enabled =
      enabledRaw === undefined || enabledRaw === null || enabledRaw === ''
        ? undefined
        : typeof enabledRaw === 'boolean'
          ? enabledRaw
          : ['true', '1', 'yes', 'y'].includes(String(enabledRaw).trim().toLowerCase());

    criteria.push({
      name,
      description: getOptionalString(row.description),
      prompt: getOptionalString(row.prompt),
      weight: weight === null ? undefined : weight,
      enabled,
    });
  });
  return criteria;
}

function parseTestCaseRows(rows: Array<Record<string, unknown>>, errors: ImportError[]): ParsedTestCase[] {
  const testCases: ParsedTestCase[] = [];

  rows.forEach((row, idx) => {
    const rowNumber = idx + 2;
    const name = getOptionalString(row.name);
    const inputText = getString(row.inputText);
    const expectedOutput = getOptionalString(row.expectedOutput);
    const notes = getOptionalString(row.notes);

    const inputVariablesRaw = getOptionalString(row.inputVariables_json);
    let inputVariables: Record<string, unknown> = {};
    if (inputVariablesRaw) {
      try {
        const parsed = JSON.parse(inputVariablesRaw) as unknown;
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
          throw new Error('inputVariables_json must be an object');
        }
        inputVariables = parsed as Record<string, unknown>;
      } catch (error) {
        errors.push({
          scope: 'row',
          sheet: 'TestCases',
          row: rowNumber,
          testCaseName: name,
          code: 'INVALID_INPUT_VARIABLES_JSON',
          message: (error as Error).message,
        });
        return;
      }
    }

    const attachmentRefs = splitSemicolon(row.attachments);
    const attachmentNames = splitSemicolon(row.attachmentNames);
    const attachmentTypes = splitSemicolon(row.attachmentTypes);
    const attachments: ParsedAttachmentRef[] = attachmentRefs.map((ref, i) => ({
      ref,
      nameHint: attachmentNames[i],
      typeHint: attachmentTypes[i],
    }));

    // Skip rows that are entirely empty.
    if (!name && !inputText && !expectedOutput && !notes && attachments.length === 0 && Object.keys(inputVariables).length === 0) {
      return;
    }

    testCases.push({
      rowNumber,
      name,
      inputText,
      expectedOutput,
      notes,
      inputVariables,
      attachments,
    });
  });

  return testCases;
}

function readSheetRows(workbook: XLSX.WorkBook, sheetNameLower: string): Array<Record<string, unknown>> {
  const actualName = workbook.SheetNames.find((name) => name.toLowerCase() === sheetNameLower);
  if (!actualName) return [];
  const sheet = workbook.Sheets[actualName];
  if (!sheet) return [];
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' });
  return Array.isArray(rows) ? rows : [];
}

export function parseEvaluationImportExcel(buffer: Buffer): ParsedExcelImport {
  if (buffer.length > DEFAULT_MAX_XLSX_BYTES) {
    throw new AppError(413, 'VALIDATION_ERROR', `import.xlsx exceeds size limit (${DEFAULT_MAX_XLSX_BYTES} bytes)`);
  }

  const errors: ImportError[] = [];

  let workbook: XLSX.WorkBook;
  try {
    workbook = XLSX.read(buffer, { type: 'buffer', cellDates: true });
  } catch (error) {
    throw new AppError(400, 'VALIDATION_ERROR', `Failed to parse import.xlsx: ${(error as Error).message}`);
  }

  const metaRows = readSheetRows(workbook, 'meta');
  const criteriaRows = readSheetRows(workbook, 'criteria');
  const testCaseRows = readSheetRows(workbook, 'testcases');

  const metaRow = metaRows[0] ?? {};
  const meta = parseMetaRow(metaRow, errors);
  const criteria = parseCriteriaRows(criteriaRows);
  const testCases = parseTestCaseRows(testCaseRows, errors);

  return { meta, criteria, testCases, errors };
}

function buildProgressPatch(progress: Record<string, unknown>): Prisma.InputJsonObject {
  return progress as Prisma.InputJsonObject;
}

function capErrors(errors: ImportError[], maxErrors: number): { errors: ImportError[]; truncated: boolean } {
  if (errors.length <= maxErrors) return { errors, truncated: false };
  return { errors: errors.slice(0, maxErrors), truncated: true };
}

async function resolvePromptAccessible(userId: string, promptId: string): Promise<string | null> {
  const prompt = await prisma.prompt.findFirst({
    where: {
      id: promptId,
      OR: [{ userId }, { isPublic: true }],
    },
    select: { id: true },
  });
  return prompt ? prompt.id : null;
}

async function resolveModelAccessible(userId: string, modelId: string): Promise<string | null> {
  const model = await prisma.model.findUnique({
    where: { id: modelId },
    select: { id: true, provider: { select: { userId: true, isSystem: true } } },
  });
  if (!model) return null;
  if (model.provider.userId !== userId && !model.provider.isSystem) return null;
  return model.id;
}

async function uploadAttachmentBuffer(
  userId: string,
  input: { filename: string; mimeType: string; buffer: Buffer }
): Promise<{ fileId: string; name: string; type: string; size: number }> {
  const stored = await filesService.upload(userId, {
    originalName: input.filename,
    mimeType: input.mimeType,
    size: input.buffer.length,
    buffer: input.buffer,
  });

  return {
    fileId: stored.id,
    name: stored.originalName,
    type: stored.mimeType,
    size: stored.size,
  };
}

async function resolveAttachmentRefToStoredFile(
  userId: string,
  zip: ZipReader,
  ref: ParsedAttachmentRef,
  options: {
    maxBytes: number;
    urlTimeoutMs: number;
    urlMaxRedirects: number;
  }
): Promise<{ stored: { fileId: string; name: string; type: string; size: number } | null; error?: string }> {
  const rawRef = ref.ref.trim();
  if (!rawRef) return { stored: null };

  const nameFromHint = ref.nameHint?.trim() || null;
  const typeFromHint = ref.typeHint?.trim() || null;

  if (isPublicHttpUrl(rawRef)) {
    const downloaded = await downloadPublicUrl(rawRef, {
      maxBytes: options.maxBytes,
      timeoutMs: options.urlTimeoutMs,
      maxRedirects: options.urlMaxRedirects,
    });

    const filename = nameFromHint || downloaded.filename || basename(new URL(downloaded.finalUrl).pathname) || 'file';
    const mimeType = typeFromHint || (downloaded.contentType ? downloaded.contentType.split(';')[0].trim() : '') || guessMimeTypeFromName(filename);
    const stored = await uploadAttachmentBuffer(userId, { filename, mimeType, buffer: downloaded.buffer });
    return { stored };
  }

  const zipPath = normalizeZipRef(rawRef);
  const buffer = await zip.readBuffer(zipPath, options.maxBytes);
  const filename = nameFromHint || basename(zipPath);
  const mimeType = typeFromHint || guessMimeTypeFromName(filename);
  const stored = await uploadAttachmentBuffer(userId, { filename, mimeType, buffer });
  return { stored };
}

function buildDefaultProgress(): ImportProgress {
  return {
    stage: 'pending',
    totalRows: 0,
    processedRows: 0,
    successRows: 0,
    failedRows: 0,
    totalAttachments: 0,
    successAttachments: 0,
    failedAttachments: 0,
  } satisfies ImportProgress;
}

export class EvaluationImportsService {
  async buildTemplateZip(locale: EvaluationImportLocale = DEFAULT_IMPORT_LOCALE): Promise<{ filename: string; buffer: Buffer }> {
    const files: Record<string, Uint8Array> = {
      'import.xlsx': buildTemplateWorkbookBuffer(locale),
      'README.txt': Buffer.from(buildTemplateReadmeText(locale), 'utf8'),
      'attachments/sample.txt': Buffer.from(buildTemplateSampleAttachmentContent(locale), 'utf8'),
    };

    const zipped = zipSync(files, { level: 6 });
    return {
      filename: `evaluation_import_template_${locale}_${IMPORT_TEMPLATE_VERSION}.zip`,
      buffer: Buffer.from(zipped),
    };
  }

  async exportEvaluationZip(
    userId: string,
    evaluationId: string,
    options?: { includeAttachments?: boolean; locale?: EvaluationImportLocale }
  ): Promise<{ filename: string; buffer: Buffer }> {
    const includeAttachments = options?.includeAttachments !== false;
    const locale = options?.locale ?? DEFAULT_IMPORT_LOCALE;
    const maxAttachmentBytes = Math.max(
      1,
      Number(process.env.EVALUATION_IMPORT_MAX_ATTACHMENT_BYTES || String(DEFAULT_MAX_ATTACHMENT_BYTES))
    );

    const evaluation = await prisma.evaluation.findFirst({
      where: { id: evaluationId, userId },
      include: {
        testCases: {
          orderBy: { orderIndex: 'asc' },
          select: {
            id: true,
            name: true,
            inputText: true,
            inputVariables: true,
            attachments: true,
            expectedOutput: true,
            notes: true,
            orderIndex: true,
          },
        },
        criteria: {
          orderBy: { createdAt: 'asc' },
          select: {
            name: true,
            description: true,
            prompt: true,
            weight: true,
            enabled: true,
          },
        },
      },
    });

    if (!evaluation) {
      throw new AppError(404, 'NOT_FOUND', 'Evaluation not found');
    }

    const config =
      evaluation.config && typeof evaluation.config === 'object' && !Array.isArray(evaluation.config)
        ? (evaluation.config as Record<string, unknown>)
        : {};

    const metaRow: Record<string, unknown> = {
      evaluationName: evaluation.name,
      promptId: evaluation.promptId ?? '',
      modelId: evaluation.modelId ?? '',
      judgeModelId: evaluation.judgeModelId ?? '',
      pass_threshold: config.pass_threshold ?? '',
      file_processing: config.file_processing ?? '',
      ocr_provider: config.ocr_provider ?? '',
      model_parameters_json: safeJsonString(config.model_parameters ?? {}),
    };

    const criteriaRows: Array<Record<string, unknown>> = evaluation.criteria.map((criterion) => ({
      name: criterion.name,
      description: criterion.description ?? '',
      prompt: criterion.prompt ?? '',
      weight: criterion.weight,
      enabled: criterion.enabled,
    }));

    const zipFiles: Record<string, Uint8Array> = {};
    const exportedAttachmentPaths = new Set<string>();
    const exportWarnings: string[] = [];

    const testCaseRows: Array<Record<string, unknown>> = [];
    for (let i = 0; i < evaluation.testCases.length; i += 1) {
      const testCase = evaluation.testCases[i];
      const attachmentsRaw = (testCase.attachments ?? []) as unknown;
      const attachments = isStoredAttachments(attachmentsRaw) ? attachmentsRaw : [];
      const refs: string[] = [];
      const nameHints: string[] = [];
      const typeHints: string[] = [];

      if (includeAttachments) {
        for (let j = 0; j < attachments.length; j += 1) {
          const attachment = attachments[j];
          const safeCase = `${String(i + 1).padStart(3, '0')}_${sanitizePathPart(
            testCase.name || `case_${i + 1}`,
            `case_${i + 1}`
          )}`;
          const safeFile = sanitizePathPart(attachment.name || `file_${j + 1}`, `file_${j + 1}`);
          const relativePath = `attachments/${safeCase}/${String(j + 1).padStart(2, '0')}_${safeFile}`;
          let exported = false;
          if (exportedAttachmentPaths.has(relativePath)) {
            exported = true;
          } else {
            try {
              const { buffer } = await filesService.downloadBuffer(userId, attachment.fileId, {
                maxBytes: maxAttachmentBytes,
              });
              zipFiles[relativePath] = buffer;
              exportedAttachmentPaths.add(relativePath);
              exported = true;
            } catch (error) {
              exportWarnings.push(formatAttachmentExportWarning(locale, {
                testCaseName: testCase.name || '',
                testCaseId: testCase.id,
                fileName: attachment.name,
                fileId: attachment.fileId,
                reason: (error as Error).message,
              }));
            }
          }

          if (exported) {
            refs.push(relativePath);
            nameHints.push(attachment.name);
            typeHints.push(attachment.type);
          }
        }
      }

      testCaseRows.push({
        name: testCase.name ?? '',
        inputText: testCase.inputText ?? '',
        inputVariables_json: safeJsonString(testCase.inputVariables ?? {}),
        attachments: refs.join(';'),
        attachmentNames: nameHints.join(';'),
        attachmentTypes: typeHints.join(';'),
        expectedOutput: testCase.expectedOutput ?? '',
        notes: testCase.notes ?? '',
      });
    }

    zipFiles['import.xlsx'] = buildImportWorkbookBuffer({
      meta: metaRow,
      criteria: criteriaRows,
      testCases: testCaseRows,
    });

    zipFiles['README.txt'] = Buffer.from(
      buildExportReadmeText(locale, {
        evaluationName: evaluation.name,
        evaluationId: evaluation.id,
        exportedAtIso: new Date().toISOString(),
        includeAttachments,
        warnings: exportWarnings,
      }),
      'utf8'
    );

    const safeEvalName = sanitizePathPart(evaluation.name, 'evaluation');
    const filename = `${safeEvalName}_import_export.zip`;
    const zipped = zipSync(zipFiles, { level: 6 });
    return { filename, buffer: Buffer.from(zipped) };
  }

  async createJob(
    userId: string,
    input: {
      mode: EvaluationImportMode;
      targetEvaluationId?: string;
      zip: { originalName: string; mimeType: string; size: number; buffer: Buffer };
    }
  ) {
    const storedZip = await filesService.upload(userId, {
      originalName: input.zip.originalName,
      mimeType: input.zip.mimeType || 'application/zip',
      size: input.zip.size,
      buffer: input.zip.buffer,
    });

    const job = await prisma.evaluationImportJob.create({
      data: {
        userId,
        mode: input.mode as never,
        status: 'pending' as never,
        sourceZipFileId: storedZip.id,
        targetEvaluationId: input.targetEvaluationId,
        progress: buildProgressPatch(buildDefaultProgress()),
        errors: [] as unknown as Prisma.InputJsonArray,
      },
      select: { id: true },
    });

    return job;
  }

  async getJob(userId: string, jobId: string) {
    const job = await prisma.evaluationImportJob.findFirst({
      where: { id: jobId, userId },
    });
    if (!job) throw new AppError(404, 'NOT_FOUND', 'Import job not found');
    return job;
  }

  async execute(jobId: string): Promise<void> {
    const job = await prisma.evaluationImportJob.findUnique({ where: { id: jobId } });
    if (!job) {
      throw new AppError(404, 'NOT_FOUND', 'Import job not found');
    }

    if (job.status === 'running') {
      return;
    }
    if (job.status === 'completed' || job.status === 'failed') {
      return;
    }

    const userId = job.userId;
    const mode = job.mode as EvaluationImportMode;
    const targetEvaluationId = job.targetEvaluationId ?? null;

    const maxErrors = Math.max(100, Number(process.env.EVALUATION_IMPORT_MAX_ERRORS || '2000'));
    const urlTimeoutMs = Math.max(1000, Number(process.env.EVALUATION_IMPORT_URL_TIMEOUT_MS || '15000'));
    const urlMaxRedirects = Math.max(0, Number(process.env.EVALUATION_IMPORT_URL_MAX_REDIRECTS || '3'));
    const maxAttachmentBytes = Math.max(1, Number(process.env.EVALUATION_IMPORT_MAX_ATTACHMENT_BYTES || String(DEFAULT_MAX_ATTACHMENT_BYTES)));
    const maxZipBytes = Math.max(1, Number(process.env.EVALUATION_IMPORT_MAX_ZIP_BYTES || String(200 * 1024 * 1024)));

    const zipLimits: ZipReaderLimits = {
      maxEntries: Math.max(1, Number(process.env.EVALUATION_IMPORT_MAX_ZIP_ENTRIES || '5000')),
      maxTotalUncompressedBytes: Math.max(
        1,
        Number(process.env.EVALUATION_IMPORT_MAX_ZIP_UNCOMPRESSED_BYTES || String(500 * 1024 * 1024))
      ),
    };

    const progress: ImportProgress = buildDefaultProgress();

    const errors: ImportError[] = [];
    const appendError = (err: ImportError) => {
      errors.push(err);
      const capped = capErrors(errors, maxErrors);
      progress.errorsTruncated = capped.truncated;
    };

    const updateJob = async (patch: {
      status?: EvaluationImportJobStatus;
      progress?: ImportProgress;
      errors?: ImportError[];
      errorMessage?: string | null;
      resultEvaluationId?: string | null;
      completedAt?: Date | null;
    }) => {
      const capped = patch.errors ? capErrors(patch.errors, maxErrors) : null;
      const nextProgress = patch.progress ? { ...patch.progress } : undefined;
      if (capped && nextProgress) {
        nextProgress.errorsTruncated = capped.truncated;
      }

      await prisma.evaluationImportJob.update({
        where: { id: jobId },
        data: {
          ...(patch.status ? { status: patch.status as never } : {}),
          ...(nextProgress ? { progress: buildProgressPatch(nextProgress) } : {}),
          ...(patch.errorMessage !== undefined ? { errorMessage: patch.errorMessage } : {}),
          ...(patch.resultEvaluationId !== undefined ? { resultEvaluationId: patch.resultEvaluationId } : {}),
          ...(patch.completedAt !== undefined ? { completedAt: patch.completedAt } : {}),
          ...(capped
            ? { errors: capped.errors as unknown as Prisma.InputJsonValue }
            : patch.errors
              ? { errors: patch.errors as unknown as Prisma.InputJsonValue }
              : {}),
        },
      });
    };

    await updateJob({ status: 'running', progress: { ...progress, stage: 'starting' }, errors: [] });

    let zip: ZipReader | null = null;

    try {
      const { buffer: zipBuffer } = await filesService.downloadBuffer(userId, job.sourceZipFileId, {
        maxBytes: maxZipBytes,
      });

      progress.stage = 'parsing_zip';
      await updateJob({ progress });

      zip = await ZipReader.fromBuffer(zipBuffer, zipLimits);

      const xlsxPath = zip.findByBasename('import.xlsx');
      if (!xlsxPath) {
        throw new AppError(400, 'VALIDATION_ERROR', 'import.xlsx not found in ZIP');
      }

      const excelBuffer = await zip.readBuffer(xlsxPath, DEFAULT_MAX_XLSX_BYTES);

      progress.stage = 'parsing_excel';
      await updateJob({ progress });

      const parsed = parseEvaluationImportExcel(excelBuffer);
      parsed.errors.forEach(appendError);

      const failedRowNumbers = new Set(
        parsed.errors
          .filter((err) => err.sheet === 'TestCases' && err.scope === 'row' && typeof err.row === 'number')
          .map((err) => err.row as number)
      );

      progress.failedRows = failedRowNumbers.size;
      progress.totalRows = parsed.testCases.length + progress.failedRows;
      progress.processedRows = progress.failedRows;
      progress.totalAttachments = parsed.testCases.reduce((sum, tc) => sum + tc.attachments.length, 0);
      await updateJob({ progress, errors });

      // Resolve target evaluation
      let evaluationId: string;
      let existingEvalConfig: Record<string, unknown> = {};

      if (mode === 'create') {
        if (!parsed.meta.evaluationName) {
          throw new AppError(400, 'VALIDATION_ERROR', 'Meta.evaluationName is required for create mode');
        }

        const resolvedPromptId = parsed.meta.promptId ? await resolvePromptAccessible(userId, parsed.meta.promptId) : null;
        if (parsed.meta.promptId && !resolvedPromptId) {
          appendError({ scope: 'meta', sheet: 'Meta', row: 2, code: 'PROMPT_NOT_ACCESSIBLE', message: 'promptId not accessible; dropped' });
        }

        const resolvedModelId = parsed.meta.modelId ? await resolveModelAccessible(userId, parsed.meta.modelId) : null;
        if (parsed.meta.modelId && !resolvedModelId) {
          appendError({ scope: 'meta', sheet: 'Meta', row: 2, code: 'MODEL_NOT_ACCESSIBLE', message: 'modelId not accessible; dropped' });
        }

        const resolvedJudgeModelId = parsed.meta.judgeModelId ? await resolveModelAccessible(userId, parsed.meta.judgeModelId) : null;
        if (parsed.meta.judgeModelId && !resolvedJudgeModelId) {
          appendError({ scope: 'meta', sheet: 'Meta', row: 2, code: 'JUDGE_MODEL_NOT_ACCESSIBLE', message: 'judgeModelId not accessible; dropped' });
        }

        const config: Prisma.InputJsonObject = {
          pass_threshold: 0.6,
          ...parsed.meta.configPatch,
        } as unknown as Prisma.InputJsonObject;

        const created = await prisma.evaluation.create({
          data: {
            userId,
            name: parsed.meta.evaluationName,
            promptId: resolvedPromptId,
            modelId: resolvedModelId,
            judgeModelId: resolvedJudgeModelId,
            status: 'pending',
            config,
            results: {} as Prisma.InputJsonObject,
            isPublic: false,
            shareAttachments: false,
          },
          select: { id: true, config: true },
        });

        evaluationId = created.id;
        existingEvalConfig =
          created.config && typeof created.config === 'object' && !Array.isArray(created.config)
            ? (created.config as Record<string, unknown>)
            : {};
      } else {
        if (!targetEvaluationId) {
          throw new AppError(400, 'VALIDATION_ERROR', 'targetEvaluationId is required for append/overwrite');
        }

        const target = await prisma.evaluation.findUnique({
          where: { id: targetEvaluationId },
          select: { id: true, userId: true, config: true },
        });
        if (!target || target.userId !== userId) {
          throw new AppError(404, 'NOT_FOUND', 'Target evaluation not found');
        }

        evaluationId = target.id;
        existingEvalConfig =
          target.config && typeof target.config === 'object' && !Array.isArray(target.config)
            ? (target.config as Record<string, unknown>)
            : {};

        // Apply Meta patch (soft-resolve prompt/model refs)
        const nextName = parsed.meta.evaluationName ? parsed.meta.evaluationName : undefined;
        let resolvedPromptId: string | undefined = undefined;
        if (parsed.meta.promptId) {
          const found = await resolvePromptAccessible(userId, parsed.meta.promptId);
          if (!found) {
            appendError({
              scope: 'meta',
              sheet: 'Meta',
              row: 2,
              code: 'PROMPT_NOT_ACCESSIBLE',
              message: 'promptId not accessible; ignored',
            });
          } else {
            resolvedPromptId = found;
          }
        }

        let resolvedModelId: string | undefined = undefined;
        if (parsed.meta.modelId) {
          const found = await resolveModelAccessible(userId, parsed.meta.modelId);
          if (!found) {
            appendError({
              scope: 'meta',
              sheet: 'Meta',
              row: 2,
              code: 'MODEL_NOT_ACCESSIBLE',
              message: 'modelId not accessible; ignored',
            });
          } else {
            resolvedModelId = found;
          }
        }

        let resolvedJudgeModelId: string | undefined = undefined;
        if (parsed.meta.judgeModelId) {
          const found = await resolveModelAccessible(userId, parsed.meta.judgeModelId);
          if (!found) {
            appendError({
              scope: 'meta',
              sheet: 'Meta',
              row: 2,
              code: 'JUDGE_MODEL_NOT_ACCESSIBLE',
              message: 'judgeModelId not accessible; ignored',
            });
          } else {
            resolvedJudgeModelId = found;
          }
        }

        const nextConfig: Record<string, unknown> = { ...existingEvalConfig, ...parsed.meta.configPatch };

        if (mode === 'overwrite') {
          progress.stage = 'resetting_evaluation';
          await updateJob({ progress, errors });

          await prisma.$transaction(async (tx) => {
            await tx.testCaseResult.deleteMany({ where: { evaluationId } });
            await tx.evaluationRun.deleteMany({ where: { evaluationId } });
            await tx.evaluationCriterion.deleteMany({ where: { evaluationId } });
            await tx.testCase.deleteMany({ where: { evaluationId } });

            await tx.evaluation.update({
              where: { id: evaluationId },
              data: {
                name: nextName,
                promptId: resolvedPromptId === undefined ? undefined : resolvedPromptId,
                modelId: resolvedModelId === undefined ? undefined : resolvedModelId,
                judgeModelId: resolvedJudgeModelId === undefined ? undefined : resolvedJudgeModelId,
                status: 'pending',
                results: {} as Prisma.InputJsonObject,
                completedAt: null,
                isPublic: false,
                shareAttachments: false,
                config: nextConfig as Prisma.InputJsonObject,
              },
            });
          });
        } else {
          await prisma.evaluation.update({
            where: { id: evaluationId },
            data: {
              ...(nextName ? { name: nextName } : {}),
              ...(resolvedPromptId !== undefined ? { promptId: resolvedPromptId } : {}),
              ...(resolvedModelId !== undefined ? { modelId: resolvedModelId } : {}),
              ...(resolvedJudgeModelId !== undefined ? { judgeModelId: resolvedJudgeModelId } : {}),
              ...(Object.keys(parsed.meta.configPatch).length > 0 ? { config: nextConfig as Prisma.InputJsonObject } : {}),
            },
          });
        }
      }

      // Criteria import
      progress.stage = 'importing_criteria';
      await updateJob({ progress, errors });

      if (parsed.criteria.length > 0) {
        if (mode === 'append') {
          const existing = await prisma.evaluationCriterion.findMany({
            where: { evaluationId },
            select: { id: true, name: true },
          });
          const byName = new Map(existing.map((c) => [c.name, c.id]));

          await prisma.$transaction(async (tx) => {
            for (const c of parsed.criteria) {
              const id = byName.get(c.name);
              if (id) {
                const updateData: Prisma.EvaluationCriterionUpdateInput = {};
                if (c.description !== undefined) updateData.description = c.description;
                if (c.prompt !== undefined) updateData.prompt = c.prompt;
                if (c.weight !== undefined) updateData.weight = c.weight;
                if (c.enabled !== undefined) updateData.enabled = c.enabled;

                if (Object.keys(updateData).length === 0) {
                  continue;
                }
                await tx.evaluationCriterion.update({
                  where: { id },
                  data: updateData,
                });
              } else {
                await tx.evaluationCriterion.create({
                  data: {
                    evaluationId,
                    name: c.name,
                    description: c.description ?? null,
                    prompt: c.prompt ?? null,
                    weight: c.weight ?? 1.0,
                    enabled: c.enabled ?? true,
                  },
                });
              }
            }
          });
        } else {
          await prisma.evaluationCriterion.createMany({
            data: parsed.criteria.map((c) => ({
              evaluationId,
              name: c.name,
              description: c.description ?? null,
              prompt: c.prompt ?? null,
              weight: c.weight ?? 1.0,
              enabled: c.enabled ?? true,
            })),
          });
        }
      }

      // TestCases import (with attachments)
      progress.stage = 'importing_test_cases';
      await updateJob({ progress, errors });

      const testCaseCreateRows: Array<{
        evaluationId: string;
        name: string;
        inputText: string;
        inputVariables: Prisma.InputJsonObject;
        attachments: Prisma.InputJsonArray;
        expectedOutput: string | null;
        notes: string | null;
        orderIndex: number;
      }> = [];

      const baseOrderIndex = mode === 'append'
        ? ((await prisma.testCase.aggregate({ where: { evaluationId }, _max: { orderIndex: true } }))._max.orderIndex ?? -1) + 1
        : 0;

        for (let i = 0; i < parsed.testCases.length; i += 1) {
        const tc = parsed.testCases[i];
        const testCaseName = tc.name || '';

        const storedAttachments: Array<{ fileId: string; name: string; type: string; size: number }> = [];

        for (const attachment of tc.attachments) {
          if (!attachment.ref.trim()) continue;
          try {
            const resolved = await resolveAttachmentRefToStoredFile(userId, zip, attachment, {
              maxBytes: maxAttachmentBytes,
              urlTimeoutMs,
              urlMaxRedirects,
            });
            if (resolved.stored) {
              storedAttachments.push(resolved.stored);
              progress.successAttachments += 1;
            }
          } catch (error) {
            progress.failedAttachments += 1;
            appendError({
              scope: 'attachment',
              sheet: 'TestCases',
              row: tc.rowNumber,
              testCaseName: testCaseName || undefined,
              ref: attachment.ref,
              code: 'ATTACHMENT_FAILED',
              message: (error as Error).message,
            });
          }
        }

        testCaseCreateRows.push({
          evaluationId,
          name: testCaseName,
          inputText: tc.inputText || '',
          inputVariables: (tc.inputVariables as Prisma.InputJsonObject) || ({} as Prisma.InputJsonObject),
          attachments: storedAttachments as unknown as Prisma.InputJsonArray,
          expectedOutput: tc.expectedOutput ?? null,
          notes: tc.notes ?? null,
          orderIndex: baseOrderIndex + i,
        });

        progress.processedRows += 1;
        progress.successRows += 1;

        if (progress.processedRows % 5 === 0) {
          await updateJob({ progress, errors });
        }
      }

      if (testCaseCreateRows.length > 0) {
        await prisma.testCase.createMany({ data: testCaseCreateRows });
      }

      progress.stage = 'completed';
      await updateJob({
        status: 'completed',
        progress,
        errors,
        resultEvaluationId: evaluationId,
        completedAt: new Date(),
      });
    } catch (error) {
      const message = error instanceof AppError ? error.message : (error as Error).message;
      progress.stage = 'failed';
      appendError({
        scope: 'excel',
        code: 'IMPORT_FAILED',
        message,
      });
      await updateJob({
        status: 'failed',
        progress,
        errors,
        errorMessage: message,
        completedAt: new Date(),
      });
      if (!(error instanceof AppError)) {
        throw error;
      }
    } finally {
      if (zip) zip.close();
    }
  }
}

export const evaluationImportsService = new EvaluationImportsService();
