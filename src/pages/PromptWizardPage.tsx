import { useState, useEffect, useRef } from 'react';
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
} from 'lucide-react';
import { Button, Input, useToast, MarkdownRenderer } from '../components/ui';
import { ThinkingBlock } from '../components/Prompt';
import { getDatabase, isDatabaseConfigured } from '../lib/database';
import { streamAIModelWithMessages, fileToBase64, extractThinking, type ChatMessage as AIChatMessage, type FileAttachment } from '../lib/ai-service';
import { getFileInputAccept, isSupportedFileType } from '../lib/file-utils';
import type { Model, Provider } from '../types';

interface PromptWizardPageProps {
  onNavigate: (page: string) => void;
}

interface Template {
  id: string;
  name: string;
  description: string;
  initialPrompt: string;
  exampleVariables?: Record<string, string>;
}

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  attachments?: FileAttachment[];
  thinking?: string;
}

const DEFAULT_TEMPLATES: Template[] = [
  {
    id: 'content-writer',
    name: '内容写作助手',
    description: '生成文章、博客、营销文案等各类内容',
    initialPrompt: '我想创建一个内容写作助手，帮助生成高质量的文章和文案。',
  },
  {
    id: 'code-assistant',
    name: '代码助手',
    description: '帮助编写、解释和调试代码',
    initialPrompt: '我想创建一个代码助手，帮助我编写和理解代码。',
  },
  {
    id: 'translator',
    name: '翻译助手',
    description: '多语言翻译和本地化',
    initialPrompt: '我想创建一个翻译助手，能够进行准确的多语言翻译。',
  },
  {
    id: 'data-analyzer',
    name: '数据分析师',
    description: '分析数据并生成洞察报告',
    initialPrompt: '我想创建一个数据分析助手，帮助分析数据并提供洞察。',
  },
  {
    id: 'customer-service',
    name: '客服助手',
    description: '回答客户问题，提供支持服务',
    initialPrompt: '我想创建一个客服助手，能够友好地回答客户问题。',
  },
  {
    id: 'custom',
    name: '自定义场景',
    description: '从零开始，自由描述您的需求',
    initialPrompt: '',
  },
];

const SYSTEM_PROMPT = `你是一个专业的 Prompt 工程师助手。你的任务是通过对话帮助用户创建高质量的 AI Prompt。

你需要：
1. 了解用户想要创建的 Prompt 的用途和目标
2. 询问关键细节，如目标受众、输出格式、特殊要求等
3. 逐步完善 Prompt 的内容
4. 在合适的时候，生成完整的 Prompt 并询问用户是否满意

当你准备好生成最终 Prompt 时，请使用以下格式：

---PROMPT_START---
[这里是生成的 Prompt 内容]
---PROMPT_END---

请用中文与用户交流。保持友好、专业，并给出有建设性的建议。`;

export function PromptWizardPage({ onNavigate }: PromptWizardPageProps) {
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
  const [promptName, setPromptName] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [copied, setCopied] = useState(false);
  const [attachedFiles, setAttachedFiles] = useState<FileAttachment[]>([]);
  const [streamingThinking, setStreamingThinking] = useState('');
  const [isThinking, setIsThinking] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const chatContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    loadModels();
  }, []);

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
      showToast('error', '请先在设置中配置数据库连接');
    }
  };

  const getModelInfo = (modelId: string) => {
    const model = models.find((m) => m.id === modelId);
    const provider = model ? providers.find((p) => p.id === model.provider_id) : null;
    return { model, provider };
  };

  const handleSelectTemplate = (template: Template) => {
    setSelectedTemplate(template);
    if (template.id === 'custom') {
      setMessages([]);
      setInputMessage('');
    } else {
      setMessages([
        { role: 'user', content: template.initialPrompt },
      ]);
    }
    setStep('chat');

    // Auto-send initial message for non-custom templates
    if (template.id !== 'custom' && template.initialPrompt) {
      sendMessage(template.initialPrompt);
    }
  };

  const sendMessage = async (content: string) => {
    if ((!content.trim() && attachedFiles.length === 0) || !selectedModelId) return;

    const currentFiles = [...attachedFiles];
    const userMessage: ChatMessage = {
      role: 'user',
      content: content.trim() || '(仅上传了图片)',
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
      const { model, provider } = getModelInfo(selectedModelId);
      if (!model || !provider) {
        showToast('error', '请选择可用的模型');
        setIsLoading(false);
        return;
      }

      const apiMessages: AIChatMessage[] = [
        { role: 'system', content: SYSTEM_PROMPT },
        ...newMessages.map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content })),
      ];

      let fullContent = '';
      let accumulatedThinking = '';

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
          onComplete: (finalContent) => {
            // 提取最终的思考内容
            const { thinking, content } = extractThinking(finalContent);

            const assistantMessage: ChatMessage = {
              role: 'assistant',
              content: content,
              thinking: thinking || undefined,
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
            }
          },
          onError: (error) => {
            showToast('error', error);
            setIsLoading(false);
            setStreamingContent('');
            setStreamingThinking('');
            setIsThinking(false);
          },
        },
        currentFiles.length > 0 ? currentFiles : undefined
      );
    } catch (e) {
      showToast('error', `发送失败: ${e instanceof Error ? e.message : 'Unknown error'}`);
      setIsLoading(false);
      setStreamingContent('');
    }
  };

  const handleSendMessage = () => {
    sendMessage(inputMessage);
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

    for (const file of Array.from(files)) {
      if (file.size > 10 * 1024 * 1024) {
        showToast('error', `文件 ${file.name} 超过 10MB 限制`);
        continue;
      }
      if (!isSupportedFileType(file)) {
        showToast('error', `${file.name} 不支持的文件类型`);
        continue;
      }
      try {
        const attachment = await fileToBase64(file);
        setAttachedFiles((prev) => [...prev, attachment]);
      } catch {
        showToast('error', `无法读取文件 ${file.name}`);
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
        e.preventDefault();
        const file = item.getAsFile();
        if (file) {
          try {
            const attachment = await fileToBase64(file);
            setAttachedFiles((prev) => [...prev, attachment]);
          } catch {
            showToast('error', '无法读取粘贴的图片');
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
      showToast('error', '复制失败');
    }
  };

  const handleSavePrompt = async () => {
    if (!promptName.trim()) {
      showToast('error', '请输入 Prompt 名称');
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
        showToast('error', '保存失败');
        return;
      }

      showToast('success', 'Prompt 已保存');
      onNavigate('prompts');
    } catch (e) {
      showToast('error', `保存失败: ${e instanceof Error ? e.message : 'Unknown error'}`);
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
              <h1 className="text-lg font-semibold text-white light:text-slate-900">Prompt 创建向导</h1>
              <p className="text-sm text-slate-400 light:text-slate-600">
                {step === 'template' && '选择场景模板'}
                {step === 'chat' && 'AI 引导创建'}
                {step === 'result' && '保存 Prompt'}
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
              <h2 className="text-xl font-semibold text-white light:text-slate-900 mb-2">选择场景模板</h2>
              <p className="text-slate-400 light:text-slate-600">
                选择一个最接近您需求的模板，或者从自定义场景开始
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
                    <span className="font-medium text-white light:text-slate-900">{template.name}</span>
                  </div>
                  <p className="text-sm text-slate-400 light:text-slate-600">{template.description}</p>
                </button>
              ))}
            </div>

            {/* Model Selection */}
            {availableModels.length > 0 && (
              <div className="mt-8 p-4 bg-slate-800/50 light:bg-slate-100 border border-slate-700 light:border-slate-200 rounded-lg">
                <label className="block text-sm font-medium text-slate-300 light:text-slate-700 mb-2">
                  对话模型
                </label>
                <select
                  value={selectedModelId}
                  onChange={(e) => setSelectedModelId(e.target.value)}
                  className="w-full max-w-xs px-3 py-2 bg-slate-800 light:bg-white border border-slate-600 light:border-slate-300 rounded-lg text-slate-200 light:text-slate-800 text-sm"
                >
                  {availableModels.map((model) => (
                    <option key={model.id} value={model.id}>
                      {model.name}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {availableModels.length === 0 && (
              <div className="mt-8 p-4 bg-amber-500/10 light:bg-amber-50 border border-amber-500/20 light:border-amber-200 rounded-lg">
                <p className="text-sm text-amber-400 light:text-amber-700">
                  请先在设置中配置并启用 AI 服务商和模型
                </p>
                <Button
                  variant="secondary"
                  size="sm"
                  className="mt-2"
                  onClick={() => onNavigate('settings')}
                >
                  前往设置
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
                  <p>描述您想创建的 Prompt，AI 会帮助您逐步完善</p>
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
                              file.type.startsWith('image/') && (
                                <img
                                  key={fileIndex}
                                  src={`data:${file.type};base64,${file.base64}`}
                                  alt={file.name}
                                  className="max-w-[200px] max-h-[150px] rounded-lg object-cover"
                                />
                              )
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
          {generatedPrompt && (
            <div className="flex-shrink-0 mx-6 mb-4 p-4 bg-emerald-500/10 light:bg-emerald-50 border border-emerald-500/20 light:border-emerald-200 rounded-lg">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 light:text-emerald-600" />
                  <span className="text-sm font-medium text-emerald-400 light:text-emerald-600">
                    Prompt 已生成
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
                    <span>保存</span>
                  </Button>
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
              {/* Model Selector in Chat */}
              <div className="flex items-center gap-2">
                <span className="text-xs text-slate-500 light:text-slate-600">当前模型:</span>
                <select
                  value={selectedModelId}
                  onChange={(e) => setSelectedModelId(e.target.value)}
                  disabled={isLoading}
                  className="flex-1 max-w-xs px-2 py-1 bg-slate-800 light:bg-white border border-slate-600 light:border-slate-300 rounded text-slate-200 light:text-slate-800 text-xs disabled:opacity-50"
                >
                  {availableModels.map((model) => (
                    <option key={model.id} value={model.id}>
                      {model.name}
                    </option>
                  ))}
                </select>
              </div>

              {/* Attached Files Preview */}
              {attachedFiles.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {attachedFiles.map((file, index) => (
                    <div
                      key={index}
                      className="relative group flex items-center gap-2 px-3 py-1.5 bg-slate-800 light:bg-slate-100 rounded-lg border border-slate-600 light:border-slate-300"
                    >
                      {file.type.startsWith('image/') ? (
                        <img
                          src={`data:${file.type};base64,${file.base64}`}
                          alt={file.name}
                          className="w-8 h-8 object-cover rounded"
                        />
                      ) : (
                        <FileText className="w-4 h-4 text-slate-400" />
                      )}
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

              <div className="flex gap-3">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept={getFileInputAccept()}
                  multiple
                  onChange={handleFileSelect}
                  className="hidden"
                />
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="p-3 rounded-xl bg-slate-800 light:bg-slate-100 border border-slate-600 light:border-slate-300 text-slate-400 light:text-slate-500 hover:text-cyan-400 light:hover:text-cyan-600 hover:border-cyan-500 transition-colors"
                  title="上传图片"
                >
                  <Paperclip className="w-5 h-5" />
                </button>
                <textarea
                  value={inputMessage}
                  onChange={(e) => setInputMessage(e.target.value)}
                  onKeyDown={handleKeyDown}
                  onPaste={handlePaste}
                  placeholder="描述您的需求...（支持粘贴图片）"
                  rows={2}
                  className="flex-1 px-4 py-3 bg-slate-800 light:bg-white border border-slate-600 light:border-slate-300 rounded-xl text-slate-200 light:text-slate-800 placeholder-slate-500 light:placeholder-slate-400 resize-none focus:outline-none focus:ring-2 focus:ring-cyan-500/50 focus:border-cyan-500"
                />
                <Button
                  onClick={handleSendMessage}
                  disabled={(!inputMessage.trim() && attachedFiles.length === 0) || isLoading || !selectedModelId}
                  className="self-end"
                >
                  {isLoading ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Send className="w-4 h-4" />
                  )}
                </Button>
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
              <h2 className="text-xl font-semibold text-white light:text-slate-900 mb-2">保存 Prompt</h2>
              <p className="text-slate-400 light:text-slate-600">
                为您的 Prompt 取个名字，然后保存到工作区
              </p>
            </div>

            <div className="space-y-4">
              <Input
                label="Prompt 名称"
                value={promptName}
                onChange={(e) => setPromptName(e.target.value)}
                placeholder="例如：内容写作助手 v1"
              />

              <div>
                <label className="block text-sm font-medium text-slate-300 light:text-slate-700 mb-2">
                  Prompt 内容
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
                <span>返回编辑</span>
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
                <span>保存 Prompt</span>
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
