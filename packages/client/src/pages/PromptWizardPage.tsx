import { useState, useEffect, useRef, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ArrowLeft,
  ArrowRight,
  Wand2,
  FileText,
  Sparkles,
  CheckCircle2,
  Loader2,
  Send,
  Bot,
  User,
  Copy,
  Check,
  Save,
  Paperclip,
  X,
  Image as ImageIcon,
  Settings2,
} from 'lucide-react';
import { Button, Input, useToast, MarkdownRenderer, ModelSelector } from '../components/ui';
import { ThinkingBlock, AttachmentPreview, AttachmentModal, ParameterPanel } from '../components/Prompt';
import { getDatabase, isDatabaseConfigured } from '../lib/database';
import { streamAIModelWithMessages, fileToBase64, extractThinking, type ChatMessage as AIChatMessage, type FileAttachment } from '../lib/ai-service';
import { getFileInputAccept, isSupportedFileType } from '../lib/file-utils';
import { getFileUploadCapabilities, isFileTypeAllowed } from '../lib/model-capabilities';
import type { Model, Provider, PromptConfig } from '../types';
import { DEFAULT_PROMPT_CONFIG } from '../types/database';

interface PromptWizardPageProps {
  onNavigate: (page: string) => void;
}

interface Template {
  id: string;
  nameKey: string;
  descriptionKey: string;
  initialPromptKey: string;
  exampleVariables?: Record<string, string>;
}

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  attachments?: FileAttachment[];
  thinking?: string;
  thinkingDurationMs?: number;
}

const DEFAULT_TEMPLATES: Template[] = [
  {
    id: 'content-writer',
    nameKey: 'wizardTemplateContentWriter',
    descriptionKey: 'wizardTemplateContentWriterDesc',
    initialPromptKey: 'wizardTemplateInitialContentWriter',
  },
  {
    id: 'code-assistant',
    nameKey: 'wizardTemplateCodeAssistant',
    descriptionKey: 'wizardTemplateCodeAssistantDesc',
    initialPromptKey: 'wizardTemplateInitialCodeAssistant',
  },
  {
    id: 'translator',
    nameKey: 'wizardTemplateTranslator',
    descriptionKey: 'wizardTemplateTranslatorDesc',
    initialPromptKey: 'wizardTemplateInitialTranslator',
  },
  {
    id: 'data-analyzer',
    nameKey: 'wizardTemplateDataAnalyzer',
    descriptionKey: 'wizardTemplateDataAnalyzerDesc',
    initialPromptKey: 'wizardTemplateInitialDataAnalyzer',
  },
  {
    id: 'customer-service',
    nameKey: 'wizardTemplateCustomerService',
    descriptionKey: 'wizardTemplateCustomerServiceDesc',
    initialPromptKey: 'wizardTemplateInitialCustomerService',
  },
  {
    id: 'custom',
    nameKey: 'wizardTemplateCustom',
    descriptionKey: 'wizardTemplateCustomDesc',
    initialPromptKey: '',
  },
];

export function PromptWizardPage({ onNavigate }: PromptWizardPageProps) {
  const { t } = useTranslation('prompts');
  const { t: tCommon } = useTranslation('common');
  const { showToast } = useToast();
  const [step, setStep] = useState<'template' | 'chat' | 'result'>('template');
  const [selectedTemplate, setSelectedTemplate] = useState<Template | null>(null);
  const [models, setModels] = useState<Model[]>([]);
  const [providers, setProviders] = useState<Provider[]>([]);
  const [selectedModelId, setSelectedModelId] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputMessage, setInputMessage] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [streamingContent, setStreamingContent] = useState('');
  const [generatedPrompt, setGeneratedPrompt] = useState('');
  const [isPromptPreviewOpen, setIsPromptPreviewOpen] = useState(true);
  const [promptName, setPromptName] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [copied, setCopied] = useState(false);
  const [attachedFiles, setAttachedFiles] = useState<FileAttachment[]>([]);
  const [streamingThinking, setStreamingThinking] = useState('');
  const [isThinking, setIsThinking] = useState(false);
  const [previewAttachment, setPreviewAttachment] = useState<FileAttachment | null>(null);
  const [modelConfig, setModelConfig] = useState<PromptConfig>(DEFAULT_PROMPT_CONFIG);
  const [showParameterPanel, setShowParameterPanel] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const chatContainerRef = useRef<HTMLDivElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const parameterPanelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    loadModels();
  }, []);

  useEffect(() => {
    return () => {
      abortControllerRef.current?.abort();
    };
  }, []);

  // 点击外部关闭参数面板
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (parameterPanelRef.current && !parameterPanelRef.current.contains(event.target as Node)) {
        setShowParameterPanel(false);
      }
    };
    if (showParameterPanel) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showParameterPanel]);

  const loadModels = async () => {
    // 检查数据库是否已配置
    if (!isDatabaseConfigured()) {
      return;
    }

    try {
      const db = getDatabase();
      const [modelsRes, providersRes] = await Promise.all([
        db.from('models').select('*'),
        db.from('providers').select('*').eq('enabled', true),
      ]);

      if (modelsRes.data) setModels(modelsRes.data);
      if (providersRes.data) {
        setProviders(providersRes.data);
        // Select first available model
        if (modelsRes.data && modelsRes.data.length > 0) {
          const enabledProviderIds = providersRes.data.map((p) => p.id);
          const availableModel = modelsRes.data.find((m) => enabledProviderIds.includes(m.provider_id));
          if (availableModel) {
            setSelectedModelId(availableModel.id);
          }
        }
      }
    } catch {
      showToast('error', t('wizardConfigureDbFirst'));
    }
  };

  const getModelInfo = (modelId: string) => {
    const model = models.find((m) => m.id === modelId);
    const provider = model ? providers.find((p) => p.id === model.provider_id) : null;
    return { model, provider };
  };

  // 计算当前选中模型的文件上传能力
  const fileUploadCapabilities = useMemo(() => {
    const { model, provider } = getModelInfo(selectedModelId);
    if (!model || !provider) {
      return { accept: '.txt,.md,.json,.csv,.xml,.yaml,.yml', canUploadImage: false, canUploadPdf: false, canUploadText: true };
    }
    return getFileUploadCapabilities(provider.type, model.model_id, model.supports_vision ?? true);
  }, [selectedModelId, models, providers]);

  const handleSelectTemplate = (template: Template) => {
    setSelectedTemplate(template);
    const initialPrompt = template.initialPromptKey ? t(template.initialPromptKey) : '';
    if (template.id === 'custom') {
      setMessages([]);
      setInputMessage('');
    } else {
      setMessages([
        { role: 'user', content: initialPrompt },
      ]);
    }
    setStep('chat');

    // Auto-send initial message for non-custom templates
    if (template.id !== 'custom' && initialPrompt) {
      sendMessage(initialPrompt);
    }
  };

  const sendMessage = async (content: string) => {
    if ((!content.trim() && attachedFiles.length === 0) || !selectedModelId) return;
    if (isLoading) return;

    const currentFiles = [...attachedFiles];
    const userMessage: ChatMessage = {
      role: 'user',
      content: content.trim() || t('wizardImageOnlyUploaded'),
      attachments: currentFiles.length > 0 ? currentFiles : undefined,
    };
    const newMessages = [...messages, userMessage];
    setMessages(newMessages);
    setInputMessage('');
    setIsLoading(true);
    setStreamingContent('');
    setStreamingThinking('');
    setIsThinking(false);
    setAttachedFiles([]);

    try {
      abortControllerRef.current?.abort();
      const { model, provider } = getModelInfo(selectedModelId);
      if (!model || !provider) {
        showToast('error', t('wizardSelectModel'));
        setIsLoading(false);
        abortControllerRef.current = null;
        return;
      }

      const abortController = new AbortController();
      abortControllerRef.current = abortController;

      const apiMessages: AIChatMessage[] = [
        { role: 'system', content: t('wizardSystemPrompt') },
        ...newMessages.map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content })),
      ];

      let fullContent = '';
      let accumulatedThinking = '';
      let thinkingStartTime = 0;
      let thinkingDuration = 0;

      await streamAIModelWithMessages(
        provider,
        model.model_id,
        apiMessages,
        {
          onToken: (token) => {
            fullContent += token;

            // 实时检测思考内容
            const { thinking, content } = extractThinking(fullContent);
            if (thinking && thinking !== accumulatedThinking) {
              if (!isThinking) {
                setIsThinking(true);
              }
              accumulatedThinking = thinking;
              setStreamingThinking(thinking);
            }

            // 显示去除思考标签后的内容
            setStreamingContent(content);

            // Auto scroll
            if (chatContainerRef.current) {
              chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight;
            }
          },
          onThinkingToken: (token) => {
            if (!isThinking) {
              setIsThinking(true);
              thinkingStartTime = Date.now();
            }
            accumulatedThinking += token;
            setStreamingThinking(accumulatedThinking);
          },
          onComplete: (finalContent) => {
            abortControllerRef.current = null;
            // 计算思考时间
            if (thinkingStartTime > 0) {
              thinkingDuration = Date.now() - thinkingStartTime;
            }

            // 提取最终的思考内容
            const { thinking, content } = extractThinking(finalContent);

            const assistantMessage: ChatMessage = {
              role: 'assistant',
              content: content,
              thinking: thinking || accumulatedThinking || undefined,
              thinkingDurationMs: (thinking || accumulatedThinking) ? thinkingDuration : undefined,
            };
            setMessages([...newMessages, assistantMessage]);
            setStreamingContent('');
            setStreamingThinking('');
            setIsThinking(false);
            setIsLoading(false);

            // Check if prompt was generated
            const promptMatch = content.match(/---PROMPT_START---\n?([\s\S]*?)\n?---PROMPT_END---/);
            if (promptMatch) {
              setGeneratedPrompt(promptMatch[1].trim());
              setIsPromptPreviewOpen(true);
            }
          },
          onAbort: () => {
            abortControllerRef.current = null;

            // 璁＄畻鎬濊€冩椂闂?
            if (thinkingStartTime > 0) {
              thinkingDuration = Date.now() - thinkingStartTime;
            }

            const { thinking, content } = extractThinking(fullContent);
            const finalThinking = thinking || accumulatedThinking || undefined;

            if (content || finalThinking) {
              const assistantMessage: ChatMessage = {
                role: 'assistant',
                content,
                thinking: finalThinking,
                thinkingDurationMs: finalThinking ? thinkingDuration : undefined,
              };
              setMessages([...newMessages, assistantMessage]);

              const promptMatch = content.match(/---PROMPT_START---\n?([\s\S]*?)\n?---PROMPT_END---/);
              if (promptMatch) {
                setGeneratedPrompt(promptMatch[1].trim());
                setIsPromptPreviewOpen(true);
              }
            }

            setStreamingContent('');
            setStreamingThinking('');
            setIsThinking(false);
            setIsLoading(false);
          },
          onError: (error) => {
            abortControllerRef.current = null;
            showToast('error', error);
            setIsLoading(false);
            setStreamingContent('');
            setStreamingThinking('');
            setIsThinking(false);
          },
        },
        currentFiles.length > 0 ? currentFiles : undefined,
        {
          parameters: {
            temperature: modelConfig.temperature,
            top_p: modelConfig.top_p,
            max_tokens: modelConfig.max_tokens,
            frequency_penalty: modelConfig.frequency_penalty,
            presence_penalty: modelConfig.presence_penalty,
          },
          reasoning: modelConfig.reasoning?.enabled
            ? {
                enabled: true,
                effort: modelConfig.reasoning.effort,
              }
            : undefined,
          signal: abortController.signal,
        }
      );
    } catch (e) {
      abortControllerRef.current = null;
      showToast('error', `${t('wizardSendFailed')}: ${e instanceof Error ? e.message : 'Unknown error'}`);
      setIsLoading(false);
      setStreamingContent('');
      setStreamingThinking('');
      setIsThinking(false);
    }
  };

  const handleSendMessage = () => {
    sendMessage(inputMessage);
  };

  const handleStopGenerating = () => {
    abortControllerRef.current?.abort();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;

    const { model, provider } = getModelInfo(selectedModelId);

    for (const file of Array.from(files)) {
      if (file.size > 10 * 1024 * 1024) {
        showToast('error', t('wizardFileTooLarge', { name: file.name }));
        continue;
      }
      if (!isSupportedFileType(file)) {
        showToast('error', t('wizardUnsupportedFileType', { name: file.name }));
        continue;
      }

      // 根据当前模型能力检查是否允许上传
      if (model && provider && !isFileTypeAllowed(file, provider.type, model.model_id, model.supports_vision ?? true)) {
        const isImage = file.type.startsWith('image/');
        const isPdf = file.type === 'application/pdf';
        if (isImage) {
          showToast('error', t('imageNotSupported'));
        } else if (isPdf) {
          showToast('error', t('pdfNotSupported'));
        }
        continue;
      }

      try {
        const attachment = await fileToBase64(file);
        setAttachedFiles((prev) => [...prev, attachment]);
      } catch {
        showToast('error', t('wizardCannotReadFile', { name: file.name }));
      }
    }
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handlePaste = async (e: React.ClipboardEvent) => {
    const items = e.clipboardData.items;
    for (const item of Array.from(items)) {
      if (item.type.startsWith('image/')) {
        // 检查当前模型是否支持图片
        if (!fileUploadCapabilities.canUploadImage) {
          showToast('error', t('imageNotSupported'));
          return;
        }
        e.preventDefault();
        const file = item.getAsFile();
        if (file) {
          try {
            const attachment = await fileToBase64(file);
            setAttachedFiles((prev) => [...prev, attachment]);
          } catch {
            showToast('error', t('wizardCannotReadPastedImage'));
          }
        }
      }
    }
  };

  const removeAttachment = (index: number) => {
    setAttachedFiles((prev) => prev.filter((_, i) => i !== index));
  };

  const handleCopyPrompt = async () => {
    try {
      await navigator.clipboard.writeText(generatedPrompt);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      showToast('error', t('wizardCopyFailed'));
    }
  };

  const handleSavePrompt = async () => {
    if (!promptName.trim()) {
      showToast('error', t('wizardEnterPromptName'));
      return;
    }

    setIsSaving(true);
    try {
      const { data, error } = await getDatabase()
        .from('prompts')
        .insert({
          name: promptName,
          description: `通过向导创建，基于模板: ${selectedTemplate?.name || '自定义'}`,
          content: generatedPrompt,
          variables: [],
          messages: [],
          config: {
            temperature: 1,
            top_p: 0.7,
            frequency_penalty: 0,
            presence_penalty: 0,
            max_tokens: 4096,
          },
          current_version: 1,
          order_index: 0,
        })
        .select()
        .single();

      if (error) {
        showToast('error', t('wizardSaveFailed'));
        return;
      }

      showToast('success', t('wizardPromptSaved'));
      onNavigate('prompts');
    } catch (e) {
      showToast('error', `${t('wizardSaveFailed')}: ${e instanceof Error ? e.message : 'Unknown error'}`);
    } finally {
      setIsSaving(false);
    }
  };

  const availableModels = models.filter((m) => {
    const provider = providers.find((p) => p.id === m.provider_id);
    return provider?.enabled;
  });

  return (
    <div className="h-full flex flex-col overflow-hidden bg-slate-950 light:bg-slate-50">
      {/* Header */}
      <div className="flex-shrink-0 p-6 border-b border-slate-700 light:border-slate-200">
        <div className="flex items-center gap-4">
          <button
            onClick={() => step === 'template' ? onNavigate('home') : setStep('template')}
            className="p-2 rounded-lg hover:bg-slate-800 light:hover:bg-slate-100 text-slate-400 light:text-slate-500 transition-colors"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-gradient-to-br from-cyan-500 to-teal-500">
              <Wand2 className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="text-lg font-semibold text-white light:text-slate-900">{t('wizardTitle')}</h1>
              <p className="text-sm text-slate-400 light:text-slate-600">
                {step === 'template' && t('wizardStepTemplate')}
                {step === 'chat' && t('wizardStepChat')}
                {step === 'result' && t('wizardStepResult')}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Template Selection */}
      {step === 'template' && (
        <div className="flex-1 overflow-y-auto p-6">
          <div className="max-w-4xl mx-auto">
            <div className="mb-6">
              <h2 className="text-xl font-semibold text-white light:text-slate-900 mb-2">{t('wizardSelectTemplate')}</h2>
              <p className="text-slate-400 light:text-slate-600">
                {t('wizardSelectTemplateDesc')}
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {DEFAULT_TEMPLATES.map((template) => (
                <button
                  key={template.id}
                  onClick={() => handleSelectTemplate(template)}
                  className="p-5 rounded-xl border border-slate-700 light:border-slate-200 hover:border-cyan-500 light:hover:border-cyan-400 bg-slate-900/50 light:bg-white transition-all text-left group"
                >
                  <div className="flex items-center gap-3 mb-3">
                    <div className={`p-2 rounded-lg ${
                      template.id === 'custom'
                        ? 'bg-purple-500/10 text-purple-400 light:bg-purple-100 light:text-purple-600'
                        : 'bg-cyan-500/10 text-cyan-400 light:bg-cyan-100 light:text-cyan-600'
                    }`}>
                      {template.id === 'custom' ? (
                        <Sparkles className="w-5 h-5" />
                      ) : (
                        <FileText className="w-5 h-5" />
                      )}
                    </div>
                    <span className="font-medium text-white light:text-slate-900">{t(template.nameKey)}</span>
                  </div>
                  <p className="text-sm text-slate-400 light:text-slate-600">{t(template.descriptionKey)}</p>
                </button>
              ))}
            </div>

            {/* Model Selection */}
            {availableModels.length > 0 && (
              <div className="mt-8 p-4 bg-slate-800/50 light:bg-slate-100 border border-slate-700 light:border-slate-200 rounded-lg">
                <label className="block text-sm font-medium text-slate-300 light:text-slate-700 mb-2">
                  {t('wizardChatModel')}
                </label>
                <div className="max-w-xs">
                  <ModelSelector
                    models={models}
                    providers={providers}
                    selectedModelId={selectedModelId}
                    onSelect={setSelectedModelId}
                    placeholder={t('wizardSelectModel')}
                  />
                </div>
              </div>
            )}

            {availableModels.length === 0 && (
              <div className="mt-8 p-4 bg-amber-500/10 light:bg-amber-50 border border-amber-500/20 light:border-amber-200 rounded-lg">
                <p className="text-sm text-amber-400 light:text-amber-700">
                  {t('wizardConfigureProviderFirst')}
                </p>
                <Button
                  variant="secondary"
                  size="sm"
                  className="mt-2"
                  onClick={() => onNavigate('settings')}
                >
                  {t('wizardGoToSettings')}
                </Button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Chat Interface */}
      {step === 'chat' && (
        <>
          <div ref={chatContainerRef} className="flex-1 overflow-y-auto p-6">
            <div className="max-w-3xl mx-auto space-y-4">
              {messages.length === 0 && !streamingContent && (
                <div className="text-center py-12 text-slate-500 light:text-slate-400">
                  <Bot className="w-12 h-12 mx-auto mb-3" />
                  <p>{t('wizardChatPlaceholder')}</p>
                </div>
              )}

              {messages.map((msg, index) => (
                <div
                  key={index}
                  className={`flex gap-3 ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                >
                  {msg.role === 'assistant' && (
                    <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-cyan-500 to-teal-500 flex items-center justify-center flex-shrink-0">
                      <Bot className="w-4 h-4 text-white" />
                    </div>
                  )}
                  <div className="max-w-[80%] space-y-2">
                    {/* Assistant thinking content */}
                    {msg.role === 'assistant' && msg.thinking && (
                      <ThinkingBlock
                        content={msg.thinking}
                        isStreaming={false}
                        durationMs={msg.thinkingDurationMs}
                        defaultExpanded={false}
                      />
                    )}
                    <div
                      className={`rounded-xl overflow-hidden ${
                        msg.role === 'user'
                          ? 'bg-cyan-500 text-white'
                          : 'bg-slate-800 light:bg-slate-100 border border-slate-700 light:border-slate-200'
                      }`}
                    >
                      {/* User message attachments */}
                      {msg.role === 'user' && msg.attachments && msg.attachments.length > 0 && (
                        <div className="p-2 pb-0">
                          <div className="flex flex-wrap gap-2">
                            {msg.attachments.map((file, fileIndex) => (
                              <div
                                key={fileIndex}
                                className="cursor-pointer hover:opacity-80 transition-opacity"
                                onClick={() => setPreviewAttachment(file)}
                              >
                                {file.type.startsWith('image/') ? (
                                  <img
                                    src={`data:${file.type};base64,${file.base64}`}
                                    alt={file.name}
                                    className="max-w-[200px] max-h-[150px] rounded-lg object-cover"
                                  />
                                ) : (
                                  <AttachmentPreview
                                    attachment={file}
                                    size="lg"
                                    showName
                                  />
                                )}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                      <div className={`p-4 ${msg.attachments && msg.attachments.length > 0 ? 'pt-2' : ''}`}>
                        {msg.role === 'assistant' ? (
                          <MarkdownRenderer content={msg.content} />
                        ) : (
                          <p className="whitespace-pre-wrap">{msg.content}</p>
                        )}
                      </div>
                    </div>
                  </div>
                  {msg.role === 'user' && (
                    <div className="w-8 h-8 rounded-lg bg-slate-700 light:bg-slate-200 flex items-center justify-center flex-shrink-0">
                      <User className="w-4 h-4 text-slate-300 light:text-slate-600" />
                    </div>
                  )}
                </div>
              ))}

              {/* Streaming thinking block */}
              {(streamingThinking || isThinking) && (
                <div className="max-w-3xl mx-auto">
                  <ThinkingBlock
                    content={streamingThinking}
                    isStreaming={isThinking}
                  />
                </div>
              )}

              {/* Streaming content */}
              {streamingContent && (
                <div className="flex gap-3">
                  <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-cyan-500 to-teal-500 flex items-center justify-center flex-shrink-0">
                    <Bot className="w-4 h-4 text-white" />
                  </div>
                  <div className="max-w-[80%] p-4 rounded-xl bg-slate-800 light:bg-slate-100 border border-slate-700 light:border-slate-200">
                    <MarkdownRenderer content={streamingContent} />
                  </div>
                </div>
              )}

              {isLoading && !streamingContent && (
                <div className="flex gap-3">
                  <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-cyan-500 to-teal-500 flex items-center justify-center flex-shrink-0">
                    <Bot className="w-4 h-4 text-white" />
                  </div>
                  <div className="p-4 rounded-xl bg-slate-800 light:bg-slate-100 border border-slate-700 light:border-slate-200">
                    <Loader2 className="w-5 h-5 animate-spin text-cyan-400" />
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Generated Prompt Preview */}
          {generatedPrompt && isPromptPreviewOpen && (
            <div className="flex-shrink-0 mx-6 mb-4 p-4 bg-emerald-500/10 light:bg-emerald-50 border border-emerald-500/20 light:border-emerald-200 rounded-lg">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 light:text-emerald-600" />
                  <span className="text-sm font-medium text-emerald-400 light:text-emerald-600">
                    {t('wizardPromptGenerated')}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={handleCopyPrompt}
                    className="p-1.5 rounded hover:bg-emerald-500/20 text-emerald-400 light:text-emerald-600 transition-colors"
                  >
                    {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                  </button>
                  <Button size="sm" onClick={() => setStep('result')}>
                    <Save className="w-4 h-4" />
                    <span>{t('wizardSave')}</span>
                  </Button>
                  <button
                    onClick={() => setIsPromptPreviewOpen(false)}
                    className="p-1.5 rounded hover:bg-emerald-500/20 text-emerald-400 light:text-emerald-600 transition-colors"
                    title={tCommon('close')}
                    aria-label={tCommon('close')}
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>
              <pre className="text-sm text-slate-300 light:text-slate-700 whitespace-pre-wrap font-mono max-h-32 overflow-y-auto">
                {generatedPrompt}
              </pre>
            </div>
          )}

          {/* Input Area */}
          <div className="flex-shrink-0 p-4 border-t border-slate-700 light:border-slate-200">
            <div className="max-w-3xl mx-auto space-y-3">
              {!isPromptPreviewOpen && generatedPrompt && (
                <div className="flex items-center justify-between px-3 py-2 bg-emerald-500/10 light:bg-emerald-50 border border-emerald-500/20 light:border-emerald-200 rounded-lg">
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 text-emerald-400 light:text-emerald-600" />
                    <span className="text-xs font-medium text-emerald-400 light:text-emerald-600">
                      {t('wizardPromptGenerated')}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={handleCopyPrompt}
                      className="p-1.5 rounded hover:bg-emerald-500/20 text-emerald-400 light:text-emerald-600 transition-colors"
                      title={tCommon('copy')}
                      aria-label={tCommon('copy')}
                    >
                      {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                    </button>
                    <Button size="sm" onClick={() => setStep('result')}>
                      <Save className="w-4 h-4" />
                      <span>{t('wizardSave')}</span>
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => setIsPromptPreviewOpen(true)}
                      title={tCommon('expand')}
                    >
                      <span>{tCommon('expand')}</span>
                    </Button>
                  </div>
                </div>
              )}

              {/* Model Selector in Chat */}
              <div className="flex items-center gap-4 flex-wrap">
                <div className="flex items-center gap-2">
                  <span className="text-xs text-slate-500 light:text-slate-600">{t('wizardCurrentModel')}</span>
                  <div className="w-64">
                    <ModelSelector
                      models={models}
                      providers={providers}
                      selectedModelId={selectedModelId}
                      onSelect={setSelectedModelId}
                      disabled={isLoading}
                      placeholder={t('wizardSelectModel')}
                    />
                  </div>
                </div>
                {/* Settings button with popover */}
                <div className="relative" ref={parameterPanelRef}>
                  <button
                    onClick={() => setShowParameterPanel(!showParameterPanel)}
                    className={`p-2 rounded-lg transition-colors ${
                      showParameterPanel
                        ? 'bg-cyan-500/20 text-cyan-400 light:bg-cyan-100 light:text-cyan-600'
                        : 'text-slate-400 light:text-slate-500 hover:text-cyan-400 light:hover:text-cyan-600 hover:bg-slate-700 light:hover:bg-slate-100'
                    }`}
                    title={t('modelParameters')}
                    disabled={isLoading}
                  >
                    <Settings2 className="w-5 h-5" />
                  </button>

                  {/* Parameter Panel Popover */}
                  {showParameterPanel && (
                    <div className="absolute bottom-full right-0 mb-2 w-80 p-3 bg-slate-800 light:bg-white border border-slate-600 light:border-slate-200 rounded-lg shadow-xl z-50">
                      <ParameterPanel
                        config={modelConfig}
                        onChange={setModelConfig}
                        disabled={isLoading}
                        defaultOpen={true}
                        modelId={models.find(m => m.id === selectedModelId)?.model_id}
                      />
                    </div>
                  )}
                </div>
              </div>

              {/* Attached Files Preview */}
              {attachedFiles.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {attachedFiles.map((file, index) => (
                    <div
                      key={index}
                      className="relative group flex items-center gap-2 px-2 py-1.5 bg-slate-800 light:bg-slate-100 rounded-lg border border-slate-600 light:border-slate-300"
                    >
                      <AttachmentPreview
                        attachment={file}
                        size="sm"
                        onClick={() => setPreviewAttachment(file)}
                      />
                      <span className="text-xs text-slate-400 light:text-slate-600 max-w-[100px] truncate">
                        {file.name}
                      </span>
                      <button
                        onClick={() => removeAttachment(index)}
                        className="p-0.5 rounded hover:bg-slate-700 light:hover:bg-slate-200 text-slate-500 hover:text-red-400"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {/* Input Area */}
              <div className="relative">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept={fileUploadCapabilities.accept}
                  multiple
                  onChange={handleFileSelect}
                  className="hidden"
                />
                <div className="flex items-end gap-2 p-3 bg-slate-800 light:bg-white border border-slate-600 light:border-slate-300 rounded-xl focus-within:ring-2 focus-within:ring-cyan-500/50 focus-within:border-cyan-500">
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    className="p-2 rounded-lg text-slate-400 light:text-slate-500 hover:text-cyan-400 light:hover:text-cyan-600 hover:bg-slate-700 light:hover:bg-slate-100 transition-colors"
                    title={t('wizardUploadFile')}
                  >
                    <Paperclip className="w-5 h-5" />
                  </button>
                  <textarea
                    value={inputMessage}
                    onChange={(e) => setInputMessage(e.target.value)}
                    onKeyDown={handleKeyDown}
                    onPaste={handlePaste}
                    placeholder={t('wizardInputPlaceholder')}
                    rows={1}
                    className="flex-1 bg-transparent text-slate-200 light:text-slate-800 placeholder-slate-500 light:placeholder-slate-400 resize-none focus:outline-none min-h-[24px] max-h-[120px]"
                    style={{ height: 'auto' }}
                    onInput={(e) => {
                      const target = e.target as HTMLTextAreaElement;
                      target.style.height = 'auto';
                      target.style.height = Math.min(target.scrollHeight, 120) + 'px';
                    }}
                  />
                  <Button
                    onClick={isLoading ? handleStopGenerating : handleSendMessage}
                    disabled={isLoading ? false : ((!inputMessage.trim() && attachedFiles.length === 0) || !selectedModelId)}
                    size="sm"
                    variant={isLoading ? 'danger' : 'primary'}
                    className="rounded-lg"
                    title={isLoading ? tCommon('stop') : undefined}
                    aria-label={isLoading ? tCommon('stop') : undefined}
                  >
                    {isLoading ? (
                      <X className="w-4 h-4" />
                    ) : (
                      <Send className="w-4 h-4" />
                    )}
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </>
      )}

      {/* Result/Save Step */}
      {step === 'result' && (
        <div className="flex-1 overflow-y-auto p-6">
          <div className="max-w-2xl mx-auto space-y-6">
            <div>
              <h2 className="text-xl font-semibold text-white light:text-slate-900 mb-2">{t('wizardSavePrompt')}</h2>
              <p className="text-slate-400 light:text-slate-600">
                {t('wizardSavePromptDesc')}
              </p>
            </div>

            <div className="space-y-4">
              <Input
                label={t('wizardPromptNameLabel')}
                value={promptName}
                onChange={(e) => setPromptName(e.target.value)}
                placeholder={t('wizardPromptNamePlaceholder')}
              />

              <div>
                <label className="block text-sm font-medium text-slate-300 light:text-slate-700 mb-2">
                  {t('wizardPromptContent')}
                </label>
                <div className="p-4 bg-slate-800/50 light:bg-slate-100 border border-slate-700 light:border-slate-200 rounded-lg">
                  <pre className="text-sm text-slate-300 light:text-slate-700 whitespace-pre-wrap font-mono max-h-64 overflow-y-auto">
                    {generatedPrompt}
                  </pre>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-4 pt-4">
              <Button
                variant="secondary"
                onClick={() => setStep('chat')}
              >
                <ArrowLeft className="w-4 h-4" />
                <span>{t('wizardBackToEdit')}</span>
              </Button>
              <Button
                onClick={handleSavePrompt}
                disabled={!promptName.trim() || isSaving}
              >
                {isSaving ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Save className="w-4 h-4" />
                )}
                <span>{t('wizardSavePromptBtn')}</span>
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Attachment Preview Modal */}
      <AttachmentModal
        attachment={previewAttachment}
        isOpen={!!previewAttachment}
        onClose={() => setPreviewAttachment(null)}
      />
    </div>
  );
}
