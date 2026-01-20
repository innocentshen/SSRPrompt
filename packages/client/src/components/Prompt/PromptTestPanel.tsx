import { useState, useRef, useMemo, useCallback, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { flushSync } from 'react-dom';
import {
  Play,
  Loader2,
  Paperclip,
  X,
  Image,
  File,
  Eye,
  Square,
} from 'lucide-react';
import { Button, MarkdownRenderer, ModelSelector, Select } from '../ui';
import { ThinkingBlock } from './ThinkingBlock';
import { AttachmentModal } from './AttachmentModal';
import { chatApi, type StreamCallbacks, type ContentPart } from '../../api/chat';
import { uploadFileAttachment, extractThinking, type FileAttachment } from '../../lib/ai-service';
import { toResponseFormat } from '../../lib/schema-utils';
import { getFileInputAccept, isSupportedFileType } from '../../lib/file-utils';
import { useToast } from '../../store/useUIStore';
import type { PromptVariable, PromptConfig, OutputSchema } from '../../types/database';
import type { Provider, Model, OcrProvider } from '../../types';

export interface PromptTestPanelProps {
  // Model selection
  models: Model[];
  providers: Provider[];
  selectedModelId: string;
  onModelSelect: (modelId: string) => void;
  recommendedModel?: { name: string; providerType: string } | null;

  // Variables
  variables: PromptVariable[];
  variableValues: Record<string, string>;
  onVariableValuesChange: (values: Record<string, string>) => void;

  // Test input
  testInput: string;
  onTestInputChange: (value: string) => void;

  // Prompt content to run
  promptText: string;

  // Config for the run
  config?: Partial<PromptConfig>;
  outputSchema?: OutputSchema;

  // Optional prompt ID for trace saving
  promptId?: string;

  // Save trace (default: false for plaza, true for development)
  saveTrace?: boolean;

  // Callback for when a run completes (for debug history)
  onRunComplete?: (result: {
    input: string;
    output: string;
    thinking?: string;
    latencyMs: number;
    tokensInput: number;
    tokensOutput: number;
    status: 'success' | 'error';
    errorMessage?: string;
    attachments?: FileAttachment[];
    ocrUsed?: boolean;
    ocrProvider?: OcrProvider;
  }) => void;

  // File attachments (optional, managed externally)
  attachedFiles?: FileAttachment[];
  onAttachedFilesChange?: (files: FileAttachment[]) => void;

  // Control file upload visibility
  showFileUpload?: boolean;

  // External output control (for syncing with debug history selection)
  externalOutput?: string;
  externalThinking?: string;
  onOutputChange?: (output: string) => void;
  onThinkingChange?: (thinking: string) => void;

  // Custom class name
  className?: string;
}

export function PromptTestPanel({
  models,
  providers,
  selectedModelId,
  onModelSelect,
  recommendedModel,
  variables,
  variableValues,
  onVariableValuesChange,
  testInput,
  onTestInputChange,
  promptText,
  config,
  outputSchema,
  promptId,
  saveTrace = false,
  onRunComplete,
  attachedFiles: externalAttachedFiles,
  onAttachedFilesChange,
  showFileUpload = true,
  externalOutput,
  externalThinking,
  onOutputChange,
  onThinkingChange,
  className = '',
}: PromptTestPanelProps) {
  const { showToast } = useToast();
  const { t } = useTranslation('prompts');
  const { t: tEval } = useTranslation('evaluation');
  const { t: tCommon } = useTranslation('common');

  // Internal state for output and running
  const [internalOutput, setInternalOutput] = useState('');
  const [internalThinking, setInternalThinking] = useState('');
  const [running, setRunning] = useState(false);
  const [isThinking, setIsThinking] = useState(false);
  const [renderMarkdown, setRenderMarkdown] = useState(true);
  const [previewAttachment, setPreviewAttachment] = useState<FileAttachment | null>(null);
  const [processingStage, setProcessingStage] = useState<'idle' | 'ocr' | 'llm'>('idle');
  const [isUploading, setIsUploading] = useState(false);

  // File attachments - use external state if provided, otherwise internal
  const [internalAttachedFiles, setInternalAttachedFiles] = useState<FileAttachment[]>([]);
  const attachedFiles = externalAttachedFiles ?? internalAttachedFiles;
  const setAttachedFiles = onAttachedFilesChange ?? setInternalAttachedFiles;

  const fileInputRef = useRef<HTMLInputElement>(null);
  const runAbortControllerRef = useRef<AbortController | null>(null);

  // Use internal output while running to keep streaming responsive.
  const output = running ? internalOutput : (externalOutput ?? internalOutput);
  const thinking = running ? internalThinking : (externalThinking ?? internalThinking);

  const currentModel = useMemo(() => models.find((m) => m.id === selectedModelId) || null, [models, selectedModelId]);
  const [fileProcessing, setFileProcessing] = useState<'auto' | 'vision' | 'ocr' | 'none'>('auto');
  const [ocrProviderOverride, setOcrProviderOverride] = useState<OcrProvider | ''>('');
  const hasBinaryAttachments = useMemo(() => (
    attachedFiles.some((f) => f.type.startsWith('image/') || f.type === 'application/pdf')
  ), [attachedFiles]);

  const resolvedFileMode = useMemo((): 'vision' | 'ocr' | 'none' => {
    if (fileProcessing === 'none') return 'none';
    if (fileProcessing === 'vision') return 'vision';
    if (fileProcessing === 'ocr') return 'ocr';
    return currentModel?.supportsVision ? 'vision' : 'ocr';
  }, [fileProcessing, currentModel?.supportsVision]);

  const willUseOcr = useMemo(() => (
    attachedFiles.length > 0 && hasBinaryAttachments && resolvedFileMode === 'ocr'
  ), [attachedFiles.length, hasBinaryAttachments, resolvedFileMode]);

  const ocrActive = running && processingStage === 'ocr';
  const llmActive = running && processingStage === 'llm';

  useEffect(() => {
    if (fileProcessing === 'vision' && currentModel && !currentModel.supportsVision) {
      setFileProcessing('auto');
    }
  }, [fileProcessing, currentModel?.supportsVision]);

  // Replace variables in prompt
  const replaceVariables = useCallback((prompt: string, values: Record<string, string>) => {
    let result = prompt;
    for (const [key, value] of Object.entries(values)) {
      result = result.replace(new RegExp(`\\{\\{\\s*${key}\\s*\\}\\}`, 'g'), value);
    }
    // Also replace variables with their default values if not provided
    for (const variable of variables) {
      if (!values[variable.name] && variable.default_value) {
        result = result.replace(new RegExp(`\\{\\{\\s*${variable.name}\\s*\\}\\}`, 'g'), variable.default_value);
      }
    }
    return result;
  }, [variables]);

  const handleStopRun = () => {
    runAbortControllerRef.current?.abort();
  };

  const handleRun = async () => {
    if (!promptText) {
      showToast('error', t('writePromptFirst'));
      return;
    }

    if (!selectedModelId) {
      showToast('error', t('configureModelFirst'));
      return;
    }

    const model = models.find((m) => m.id === selectedModelId);
    const provider = providers.find((p) => p.id === model?.providerId);

    if (!model || !provider) {
      showToast('error', t('configureModelProviderFirst'));
      return;
    }

    runAbortControllerRef.current?.abort();
    const runAbortController = new AbortController();
    runAbortControllerRef.current = runAbortController;

    setRunning(true);
    setInternalOutput('');
    setInternalThinking('');
    setIsThinking(false);
    onOutputChange?.('');
    onThinkingChange?.('');

    const startTime = Date.now();

    try {
      const resolveFileMode = (supportsVision: boolean): 'vision' | 'ocr' | 'none' => {
        if (fileProcessing === 'none') return 'none';
        if (fileProcessing === 'vision') return 'vision';
        if (fileProcessing === 'ocr') return 'ocr';
        return supportsVision ? 'vision' : 'ocr';
      };

      const effectiveMode = resolveFileMode(model.supportsVision ?? true);
      const runNeedsOcr = attachedFiles.length > 0 && hasBinaryAttachments && effectiveMode === 'ocr';
      setProcessingStage(runNeedsOcr ? 'ocr' : 'llm');
      const runOcrUsed = runNeedsOcr;
      const runOcrProvider = runNeedsOcr ? (ocrProviderOverride || undefined) : undefined;

      // Replace variables in prompt
      const finalPrompt = replaceVariables(promptText, variableValues);
      const fullPrompt = testInput ? `${finalPrompt}\n\n${testInput}` : finalPrompt;

      // Build user message content with attachments
      let userContent: string | ContentPart[] = fullPrompt;

      if (attachedFiles.length > 0) {
        const contentParts: ContentPart[] = [
          { type: 'text' as const, text: fullPrompt }
        ];
        for (const file of attachedFiles) {
          contentParts.push({
            type: 'file_ref' as const,
            file_ref: { fileId: file.fileId },
          });
        }
        userContent = contentParts;
      }

      let fullContent = '';
      let accumulatedThinking = '';
      let isCurrentlyThinking = false;
      let latestOutput = '';
      let latestThinking = '';

      const callbacks: StreamCallbacks = {
        onToken: (token) => {
          setProcessingStage((prev) => (prev === 'ocr' ? 'llm' : prev));
          fullContent += token;

          // When receiving content, end thinking state
          if (isCurrentlyThinking) {
            isCurrentlyThinking = false;
            flushSync(() => {
              setIsThinking(false);
            });
          }

          // Extract thinking content (for text tag format like <think>)
          const { thinking: extractedThinking, content } = extractThinking(fullContent);

          if (extractedThinking && extractedThinking !== accumulatedThinking) {
            accumulatedThinking = extractedThinking;
            latestThinking = extractedThinking;
            setInternalThinking(extractedThinking);
          }

          // Show content without thinking tags - use flushSync for streaming render
          latestOutput = content;
          flushSync(() => {
            setInternalOutput(content);
          });
        },
        onThinkingToken: (token) => {
          setProcessingStage((prev) => (prev === 'ocr' ? 'llm' : prev));
          // Streaming thinking content (for OpenRouter reasoning field)
          if (!isCurrentlyThinking) {
            isCurrentlyThinking = true;
            flushSync(() => {
              setIsThinking(true);
            });
          }
          accumulatedThinking += token;
          latestThinking = accumulatedThinking;
          flushSync(() => {
            setInternalThinking(accumulatedThinking);
          });
        },
        onComplete: async (result) => {
          runAbortControllerRef.current = null;
          setProcessingStage('idle');
          const latencyMs = Date.now() - startTime;

          // Get token counts from usage
          const tokensInput = result.usage?.prompt_tokens || 0;
          const tokensOutput = result.usage?.completion_tokens || 0;

          // Extract final thinking content
          const { thinking: extractedThinking, content } = extractThinking(result.content);
          const finalThinking = result.thinking || extractedThinking || accumulatedThinking;

          latestThinking = finalThinking;
          setInternalThinking(finalThinking);
          setIsThinking(false);

          const outputText = `${content}\n\n---\n**${t('processingTime')}:** ${(latencyMs / 1000).toFixed(2)}s`;
          latestOutput = outputText;
          setInternalOutput(outputText);
          onThinkingChange?.(finalThinking);
          onOutputChange?.(outputText);

          // Call onRunComplete callback
          onRunComplete?.({
            input: testInput,
            output: content,
            thinking: finalThinking || undefined,
            latencyMs,
            tokensInput,
            tokensOutput,
            status: 'success',
            attachments: attachedFiles.length > 0 ? [...attachedFiles] : undefined,
            ocrUsed: runOcrUsed,
            ocrProvider: runOcrProvider,
          });

          setRunning(false);
          showToast('success', t('runComplete'));
        },
        onAbort: () => {
          runAbortControllerRef.current = null;
          setProcessingStage('idle');
          setIsThinking(false);
          onThinkingChange?.(latestThinking);
          onOutputChange?.(latestOutput);
          setRunning(false);
          showToast('info', t('runStopped'));
        },
        onError: async (error) => {
          runAbortControllerRef.current = null;
          setProcessingStage('idle');
          const errorMessage = error.message;
          const errorOutput = `**[${t('error')}]**\n\n${errorMessage}\n\n${t('errorCheckList')}`;
          latestOutput = errorOutput;
          setInternalOutput(errorOutput);
          onThinkingChange?.('');
          onOutputChange?.(errorOutput);

          // Call onRunComplete callback with error
          onRunComplete?.({
            input: testInput,
            output: '',
            latencyMs: Date.now() - startTime,
            tokensInput: 0,
            tokensOutput: 0,
            status: 'error',
            errorMessage,
            attachments: attachedFiles.length > 0 ? [...attachedFiles] : undefined,
            ocrUsed: runOcrUsed,
            ocrProvider: runOcrProvider,
          });

          setRunning(false);
          showToast('error', t('runFailed') + ': ' + errorMessage);
        },
      };

      await chatApi.streamWithCallbacks(
        {
          modelId: model.id,
          messages: [{ role: 'user', content: userContent }],
          promptId,
          temperature: config?.temperature,
          top_p: config?.top_p,
          max_tokens: config?.max_tokens,
          frequency_penalty: config?.frequency_penalty,
          presence_penalty: config?.presence_penalty,
          reasoning: config?.reasoning?.enabled && config?.reasoning?.effort !== 'default'
            ? { enabled: true, effort: config.reasoning.effort }
            : undefined,
          responseFormat: outputSchema?.enabled
            ? toResponseFormat(outputSchema)
            : undefined,
          saveTrace,
          fileProcessing,
          ocrProvider: ocrProviderOverride || undefined,
        },
        callbacks,
        runAbortController.signal
      );
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : t('unknownError');
      const errorOutput = `**[${t('error')}]**\n\n${errorMessage}\n\n${t('errorCheckList')}`;
      setInternalOutput(errorOutput);
      onThinkingChange?.('');
      onOutputChange?.(errorOutput);
      setProcessingStage('idle');
      setRunning(false);
      showToast('error', t('runFailed') + ': ' + errorMessage);
    }
  };

  const handleAddFileClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const maxSize = 20 * 1024 * 1024;
    const newAttachments: FileAttachment[] = [];

    setIsUploading(true);

    for (const file of Array.from(files)) {
      if (file.size > maxSize) {
        showToast('error', t('fileTooLarge', { name: file.name }));
        continue;
      }

      // Use new file type validation
      if (!isSupportedFileType(file)) {
        showToast('error', t('unsupportedFileType', { name: file.name }));
        continue;
      }

      try {
        const attachment = await uploadFileAttachment(file);
        newAttachments.push(attachment);
      } catch {
        showToast('error', t('fileReadFailed', { name: file.name }));
      }
    }

    setIsUploading(false);

    if (newAttachments.length > 0) {
      setAttachedFiles([...attachedFiles, ...newAttachments]);
    }

    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handlePaste = async (e: React.ClipboardEvent) => {
    const items = e.clipboardData.items;
    const newAttachments: FileAttachment[] = [];
    let hasImage = false;

    for (const item of Array.from(items)) {
      if (item.type.startsWith('image/')) {
        hasImage = true;
        break;
      }
    }

    if (!hasImage) return;

    setIsUploading(true);

    for (const item of Array.from(items)) {
      if (item.type.startsWith('image/')) {
        e.preventDefault();
        const file = item.getAsFile();
        if (file) {
          if (file.size > 20 * 1024 * 1024) {
            showToast('error', t('imageTooLarge'));
            continue;
          }
          try {
            const attachment = await uploadFileAttachment(file);
            newAttachments.push(attachment);
            showToast('success', t('imageAdded'));
          } catch {
            showToast('error', t('cannotReadImage'));
          }
        }
      }
    }

    setIsUploading(false);

    if (newAttachments.length > 0) {
      setAttachedFiles([...attachedFiles, ...newAttachments]);
    }
  };

  const removeFile = (index: number) => {
    setAttachedFiles(attachedFiles.filter((_, i) => i !== index));
  };

  const getFileIcon = (type: string) => {
    if (type.startsWith('image/')) return Image;
    return File;
  };

  return (
    <div className={`flex flex-col overflow-hidden ${className}`}>
      <div className="flex-shrink-0 p-4 border-b border-slate-700 light:border-slate-200">
        <h3 className="text-sm font-medium text-slate-300 light:text-slate-700">{t('testAndOutput')}</h3>
      </div>
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* Model selector */}
        <div className="space-y-2">
          <div className="text-xs text-slate-500 light:text-slate-600">{tCommon('selectModel')}</div>
          <ModelSelector
            models={models}
            providers={providers}
            selectedModelId={selectedModelId}
            onSelect={onModelSelect}
          />
          {recommendedModel && (
            <div className="text-xs text-slate-500 light:text-slate-600">
              {t('recommendedModel')}: {recommendedModel.name} ({recommendedModel.providerType})
            </div>
          )}
        </div>

        {/* Variable values input */}
        {variables.length > 0 && (
          <div className="space-y-2">
            <label className="block text-sm font-medium text-slate-300 light:text-slate-700">
              {t('variableValues')}
            </label>
            <div className="space-y-2 p-3 bg-slate-800/50 light:bg-slate-50 rounded-lg border border-slate-700 light:border-slate-200">
              {variables.map((variable) => (
                <div key={variable.name} className="flex items-center gap-2">
                  <code className="text-xs text-amber-400 light:text-amber-600 font-mono min-w-[100px]">
                    {`{{${variable.name}}}`}
                    {variable.required && <span className="text-red-400">*</span>}
                  </code>
                  <input
                    type="text"
                    value={variableValues[variable.name] || ''}
                    onChange={(e) =>
                      onVariableValuesChange({
                        ...variableValues,
                        [variable.name]: e.target.value,
                      })
                    }
                    placeholder={variable.default_value || variable.description || t('inputValuePlaceholder')}
                    className="flex-1 px-2 py-1.5 bg-slate-800 light:bg-white border border-slate-600 light:border-slate-300 rounded text-sm text-slate-200 light:text-slate-800 placeholder-slate-500 focus:outline-none focus:border-cyan-500"
                  />
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Test input */}
        <div className="space-y-1.5">
          <label className="block text-sm font-medium text-slate-300 light:text-slate-700">
            {t('testInput')}
          </label>
          <textarea
            value={testInput}
            onChange={(e) => onTestInputChange(e.target.value)}
            onPaste={handlePaste}
            placeholder={t("inputPlaceholder")}
            rows={4}
            className="w-full p-3 bg-slate-800 light:bg-white border border-slate-700 light:border-slate-300 rounded-lg text-sm text-slate-200 light:text-slate-800 placeholder-slate-500 light:placeholder-slate-400 resize-none focus:outline-none focus:border-cyan-500"
          />
        </div>

        {/* Attachments */}
        {showFileUpload && (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="block text-sm font-medium text-slate-300 light:text-slate-700">
                {t('attachments')}
              </label>
              <button
                type="button"
                onClick={handleAddFileClick}
                className="flex items-center gap-1 text-xs transition-colors text-cyan-400 hover:text-cyan-300"
              >
                <Paperclip className="w-3.5 h-3.5" />
                {t('addFile')}
              </button>
            </div>
            <div className="grid grid-cols-1 gap-2">
              <Select
                label={tEval('fileProcessing')}
                value={fileProcessing}
                onChange={(e) => setFileProcessing(e.target.value as typeof fileProcessing)}
                options={[
                  { value: 'auto', label: tEval('fileProcessingAuto') },
                  ...(currentModel?.supportsVision ? [{ value: 'vision', label: tEval('fileProcessingVision') }] : []),
                  { value: 'ocr', label: tEval('fileProcessingOcr') },
                  { value: 'none', label: tEval('fileProcessingNone') },
                ]}
              />
              {(fileProcessing === 'ocr' ||
                ((fileProcessing || 'auto') === 'auto' && currentModel && !currentModel.supportsVision)) && (
                <Select
                  value={ocrProviderOverride}
                  onChange={(e) => setOcrProviderOverride(e.target.value as OcrProvider | '')}
                   options={[
                     { value: '', label: tEval('ocrProviderFollow') },
                     { value: 'paddle', label: 'PaddleOCR' },
                     { value: 'paddle_vl', label: tEval('ocrProviderPaddleVl') },
                     { value: 'datalab', label: tEval('ocrProviderDatalab') },
                     { value: 'mineru', label: tEval('ocrProviderMineru') },
                   ]}
                 />
               )}
            </div>
            {attachedFiles.length > 0 && (
              <div className="flex items-center gap-2 text-xs text-slate-500 light:text-slate-600">
                {resolvedFileMode === 'none' ? (
                  <span>{tEval('fileProcessingNone')}</span>
                ) : willUseOcr ? (
                  <>
                    <span className={ocrActive ? 'text-cyan-400' : ''}>OCR</span>
                    <span>→</span>
                    <span className={llmActive ? 'text-cyan-400' : ''}>LLM</span>
                  </>
                ) : (
                  <span className={llmActive ? 'text-cyan-400' : ''}>LLM</span>
                )}
              </div>
            )}
            <input
              ref={fileInputRef}
              type="file"
              accept={getFileInputAccept()}
              multiple
              onChange={handleFileSelect}
              className="hidden"
            />
            {isUploading && (
              <div className="flex items-center gap-2 p-2 bg-slate-800/50 light:bg-slate-50 border border-slate-700 light:border-slate-300 rounded-lg">
                <Loader2 className="w-4 h-4 animate-spin text-cyan-400" />
                <span className="text-xs text-slate-400 light:text-slate-600">{t('uploading')}</span>
              </div>
            )}
            {attachedFiles.length > 0 ? (
              <div className="space-y-1.5">
                {attachedFiles.map((file, index) => {
                  const FileIcon = getFileIcon(file.type);
                  return (
                    <div
                      key={index}
                      className="flex items-center gap-2 p-2 bg-slate-800 light:bg-white border border-slate-700 light:border-slate-300 rounded-lg"
                    >
                      <button
                        type="button"
                        onClick={() => setPreviewAttachment(file)}
                        className="flex-1 flex items-center gap-2 min-w-0 hover:text-cyan-400 light:hover:text-cyan-600 transition-colors"
                        title={t('clickToPreview')}
                      >
                        <FileIcon className="w-4 h-4 text-slate-400 flex-shrink-0" />
                        <span className="text-xs text-slate-300 light:text-slate-700 truncate">
                          {file.name}
                        </span>
                        <Eye className="w-3 h-3 text-cyan-400 light:text-cyan-600 flex-shrink-0" />
                      </button>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          removeFile(index);
                        }}
                        className="p-1 text-slate-500 hover:text-red-400 transition-colors flex-shrink-0"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="p-2 border border-dashed border-slate-700 light:border-slate-300 rounded-lg text-center">
                <p className="text-xs text-slate-500 light:text-slate-600">
                  {t('supportedFileTypes')}
                </p>
              </div>
            )}
          </div>
        )}

        {running ? (
          <Button className="w-full" variant="danger" onClick={handleStopRun}>
            <Square className="w-4 h-4" />
            <span>{tCommon('stop')}</span>
          </Button>
        ) : (
          <Button className="w-full" onClick={handleRun}>
            <Play className="w-4 h-4" />
            <span>{t('run')}</span>
          </Button>
        )}

        {/* Thinking Block */}
        {(thinking || isThinking) && (
          <ThinkingBlock
            content={thinking}
            isStreaming={isThinking}
          />
        )}

        {/* Output */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label className="block text-sm font-medium text-slate-300 light:text-slate-700">
              {t('outputResult')}
            </label>
            <button
              type="button"
              onClick={() => setRenderMarkdown(!renderMarkdown)}
              className={`text-xs px-2 py-1 rounded transition-colors ${
                renderMarkdown
                  ? 'bg-cyan-500/20 text-cyan-400'
                  : 'bg-slate-700 light:bg-slate-200 text-slate-400 light:text-slate-600 hover:text-slate-300 light:hover:text-slate-800'
              }`}
            >
              {renderMarkdown ? t('markdown') : t('plainText')}
            </button>
          </div>
          <div className="min-h-[200px] max-h-[400px] p-3 bg-slate-800/50 light:bg-white border border-slate-700 light:border-slate-300 rounded-lg text-sm text-slate-300 light:text-slate-700 overflow-y-auto">
            {output ? (
              renderMarkdown ? (
                <MarkdownRenderer content={output} />
              ) : (
                <pre className="whitespace-pre-wrap font-mono">{output}</pre>
              )
            ) : running ? (
              <div className="flex items-center gap-2 text-slate-500 light:text-slate-600">
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>{processingStage === 'ocr' ? `${tEval('fileProcessingOcr')}...` : t('generating')}</span>
              </div>
            ) : (
              <span className="text-slate-500 light:text-slate-600">{t('clickRunToSeeResult')}</span>
            )}
          </div>
        </div>
      </div>

      {/* Attachment Preview Modal */}
      <AttachmentModal
        attachment={previewAttachment}
        isOpen={!!previewAttachment}
        onClose={() => setPreviewAttachment(null)}
      />
    </div>
  );
}
