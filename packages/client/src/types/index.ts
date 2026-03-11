// Re-export all types from shared package (camelCase)
export type {
  // Provider types
  Provider,
  Model,
  ProviderType,
  CreateProviderDto,
  UpdateProviderDto,
  CreateModelDto,
  UpdateModelDto,

  // Prompt types - base types
  Prompt,
  PromptListItem,
  PromptVersion,
  PublicPromptListItem,
  PublicPromptDetail,
  CopyPublicPromptDto,
  CreatePromptDto,
  UpdatePromptDto,
  PromptGroup,
  CreatePromptGroupDto,
  UpdatePromptGroupDto,
  PromptApiKey,
  CreatePromptApiKeyDto,
  CreatePromptApiKeyResult,

  // Evaluation types
  Evaluation,
  EvaluationStatus,
  EvaluationConfig,
  TestCase,
  EvaluationCriterion,
  EvaluationRun,
  RunConfig,
  TestCaseResult,
  ModelParameters,
  CreateEvaluationDto,
  UpdateEvaluationDto,
  CreateTestCaseDto,
  UpdateTestCaseDto,
  CreateCriterionDto,
  UpdateCriterionDto,
  EvaluationDetail,
  EvaluationAnalysisScope,
  EvaluationAnalysisReport,
  CreateEvaluationAnalysisReportDto,
  UpdateEvaluationAnalysisReportDto,

  // Trace types
  Trace,
  TraceListItem,
  TraceStatus,
  TraceSource,
  FileAttachment,
  CreateTraceDto,
  PaginatedResponse,

  // OCR types
  OcrProvider,
  OcrCredentialSource,
  DatalabOcrMode,
  DatalabOcrParams,
  MineruModelVersion,
  MineruOcrParams,
  MultimodalOcrParams,
  OcrProviderSettings,
  UpdateOcrProviderSettingsDto,
  OcrSystemProviderSettings,
  UpdateOcrSystemProviderSettingsDto,
  OcrTestResult,
  OcrStatus,
  OcrResultItem,
  OcrResultsRequest,

  // Share types
  ShareResourceType,
  ShareAccessAction,
  ShareLink,
  ShareAccessLog,
  ShareLinkPage,
  ShareAccessLogPage,
  CreateShareLinkDto,
  UpdateShareLinkDto,
  ListShareLinksQueryDto,
  VerifySharePasswordDto,
  SharePromptContent,
  ShareEvaluationContent,
  SharePromptDetail,
  ShareEvaluationDetail,
} from '@ssrprompt/shared';

// Re-export frontend-specific types from database.ts
export type {
  ReasoningEffort,
  PromptMessageRole,
  PromptMessage,
  PromptVariableType,
  PromptVariable,
  ReasoningConfig,
  SchemaFieldType,
  SchemaField,
  OutputSchema,
  PromptConfig,
} from './database';

export { DEFAULT_PROMPT_CONFIG } from './database';

// Navigation types
export type NavigationItem = {
  id: string;
  name: string;
  icon: string;
  path: string;
};

export type ModalProps = {
  isOpen: boolean;
  onClose: () => void;
};

// Extended types
import type { Provider as SharedProvider, Model as SharedModel, FileAttachment as SharedFileAttachment } from '@ssrprompt/shared';

export interface ProviderWithModels extends SharedProvider {
  models?: SharedModel[];
}

// Legacy type aliases for backwards compatibility (deprecated)
export type FileAttachmentData = SharedFileAttachment;
