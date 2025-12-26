import { useState, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Trash2, Paperclip, X, FileText, Image, Check, Loader2, Eye, EyeOff, Maximize2, Code, File, Play } from 'lucide-react';
import { Button, Modal, MarkdownRenderer } from '../ui';
import { AttachmentModal } from '../Prompt/AttachmentModal';
import type { TestCase, FileAttachmentData, ProviderType } from '../../types';
import { getFileInputAccept, isSupportedFileType, getFileIconType } from '../../lib/file-utils';
import { isFileTypeAllowed } from '../../lib/model-capabilities';

interface FileUploadCapabilities {
  accept: string;
  canUploadImage: boolean;
  canUploadPdf: boolean;
  canUploadText: boolean;
}

interface TestCaseEditorProps {
  testCase: TestCase;
  index: number;
  variables: string[];
  onUpdate: (testCase: TestCase) => Promise<void>;
  onDelete: () => void;
  onRunSingle?: () => void;
  isRunning?: boolean;
  isSaving?: boolean;
  fileUploadCapabilities?: FileUploadCapabilities;
  providerType?: ProviderType;
  modelId?: string;
  supportsVision?: boolean;
}

interface LocalInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  rows?: number;
  as?: 'input' | 'textarea';
}

function LocalInput({ value, onChange, placeholder, className, rows, as = 'input' }: LocalInputProps) {
  const [localValue, setLocalValue] = useState(value);
  const isComposing = useRef(false);

  useEffect(() => {
    if (!isComposing.current) {
      setLocalValue(value);
    }
  }, [value]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    setLocalValue(e.target.value);
  };

  const handleBlur = () => {
    if (localValue !== value) {
      onChange(localValue);
    }
  };

  const handleCompositionStart = () => {
    isComposing.current = true;
  };

  const handleCompositionEnd = (e: React.CompositionEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    isComposing.current = false;
    setLocalValue((e.target as HTMLInputElement | HTMLTextAreaElement).value);
  };

  const commonProps = {
    value: localValue,
    onChange: handleChange,
    onBlur: handleBlur,
    onCompositionStart: handleCompositionStart,
    onCompositionEnd: handleCompositionEnd,
    placeholder,
    className,
  };

  if (as === 'textarea') {
    return <textarea {...commonProps} rows={rows} />;
  }

  return <input type="text" {...commonProps} />;
}

export function TestCaseEditor({
  testCase,
  index,
  variables,
  onUpdate,
  onDelete,
  onRunSingle,
  isRunning,
  isSaving,
  fileUploadCapabilities,
  providerType,
  modelId,
  supportsVision = true,
}: TestCaseEditorProps) {
  const { t } = useTranslation('evaluation');
  const { t: tCommon } = useTranslation('common');
  const [isExpanded, setIsExpanded] = useState(false);
  const [localSaving, setLocalSaving] = useState(false);
  const [previewInput, setPreviewInput] = useState(false);
  const [previewExpected, setPreviewExpected] = useState(false);
  const [expandedField, setExpandedField] = useState<'input' | 'expected' | null>(null);
  const [expandedValue, setExpandedValue] = useState('');
  const [expandedPreview, setExpandedPreview] = useState(false);
  const [previewAttachment, setPreviewAttachment] = useState<FileAttachmentData | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleUpdate = async (updates: Partial<TestCase>) => {
    setLocalSaving(true);
    await onUpdate({ ...testCase, ...updates });
    setLocalSaving(false);
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const newAttachments: FileAttachmentData[] = [];

    for (const file of Array.from(files)) {
      if (!isSupportedFileType(file)) {
        continue; // Skip unsupported files
      }

      // 根据模型能力检查是否允许上传
      if (providerType && modelId && !isFileTypeAllowed(file, providerType, modelId, supportsVision)) {
        // 静默跳过不支持的文件类型（UI 层面已经通过 accept 限制了）
        continue;
      }

      const base64 = await fileToBase64(file);
      newAttachments.push({
        name: file.name,
        type: file.type,
        base64,
      });
    }

    const updatedAttachments = [...testCase.attachments, ...newAttachments];
    await handleUpdate({
      attachments: updatedAttachments,
    });

    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const fileToBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result as string;
        const base64 = result.split(',')[1];
        resolve(base64);
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  };

  const removeAttachment = async (attachmentIndex: number) => {
    const updatedAttachments = testCase.attachments.filter((_, i) => i !== attachmentIndex);
    await handleUpdate({
      attachments: updatedAttachments,
    });
  };

  const updateVariable = async (varName: string, value: string) => {
    await handleUpdate({
      input_variables: {
        ...testCase.input_variables,
        [varName]: value,
      },
    });
  };

  const getFileIcon = (attachment: { type: string; name?: string }) => {
    const iconType = getFileIconType(attachment);
    switch (iconType) {
      case 'image':
        return Image;
      case 'pdf':
        return FileText;
      case 'code':
        return Code;
      case 'text':
        return FileText;
      default:
        return File;
    }
  };

  const openExpandModal = (field: 'input' | 'expected') => {
    setExpandedField(field);
    setExpandedValue(field === 'input' ? testCase.input_text : (testCase.expected_output || ''));
    setExpandedPreview(false);
  };

  const closeExpandModal = async () => {
    if (expandedField === 'input') {
      await handleUpdate({ input_text: expandedValue });
    } else if (expandedField === 'expected') {
      await handleUpdate({ expected_output: expandedValue || null });
    }
    setExpandedField(null);
    setExpandedValue('');
    setExpandedPreview(false);
  };

  const showSaving = isSaving || localSaving;

  return (
    <div className="border border-slate-700 light:border-slate-200 rounded-lg bg-slate-800/30 light:bg-white overflow-hidden light:shadow-sm">
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full flex items-center justify-between p-4 hover:bg-slate-800/50 light:hover:bg-slate-50 transition-colors"
      >
        <div className="flex items-center gap-3">
          <span className="w-6 h-6 rounded-full bg-slate-700 light:bg-cyan-100 flex items-center justify-center text-xs font-medium text-slate-300 light:text-cyan-700">
            {index + 1}
          </span>
          <span className="text-sm font-medium text-slate-200 light:text-slate-800">
            {testCase.name || t('testCaseNum', { num: index + 1 })}
          </span>
          {testCase.attachments.length > 0 && (
            <span className="text-xs text-slate-500 light:text-slate-600">
              ({t('attachmentsCount', { count: testCase.attachments.length })})
            </span>
          )}
          {showSaving ? (
            <span className="flex items-center gap-1 text-xs text-amber-400 light:text-amber-600">
              <Loader2 className="w-3 h-3 animate-spin" />
              {t('saving')}
            </span>
          ) : (
            <span className="flex items-center gap-1 text-xs text-emerald-400 light:text-emerald-600">
              <Check className="w-3 h-3" />
              {t('saved')}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          {onRunSingle && (
            <Button
              variant="ghost"
              size="sm"
              onClick={(e) => {
                e.stopPropagation();
                onRunSingle();
              }}
              disabled={isRunning}
              title={t('runThisCase')}
            >
              {isRunning ? (
                <Loader2 className="w-4 h-4 text-cyan-400 animate-spin" />
              ) : (
                <Play className="w-4 h-4 text-slate-500 light:text-slate-400 hover:text-cyan-400" />
              )}
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            onClick={(e) => {
              e.stopPropagation();
              onDelete();
            }}
          >
            <Trash2 className="w-4 h-4 text-slate-500 light:text-slate-400 hover:text-rose-400" />
          </Button>
        </div>
      </button>

      {isExpanded && (
        <div className="p-4 pt-0 space-y-4 border-t border-slate-700/50 light:border-slate-200">
          <div>
            <label className="block text-sm font-medium text-slate-300 light:text-slate-700 mb-2">
              {t('testCaseName')}
            </label>
            <LocalInput
              value={testCase.name}
              onChange={(value) => handleUpdate({ name: value })}
              placeholder={t('enterTestCaseName')}
              className="w-full px-3 py-2 bg-slate-800 light:bg-white border border-slate-600 light:border-slate-300 rounded-lg text-slate-200 light:text-slate-800 placeholder-slate-500 light:placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-cyan-500/50 focus:border-cyan-500 text-sm"
            />
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="block text-sm font-medium text-slate-300 light:text-slate-700">
                {t('inputText')}
              </label>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => openExpandModal('input')}
                  className="flex items-center gap-1 text-xs px-2 py-1 rounded transition-colors bg-slate-700 light:bg-slate-200 text-slate-400 light:text-slate-600 hover:text-slate-300 light:hover:text-slate-800"
                  title={t('expandEdit')}
                >
                  <Maximize2 className="w-3 h-3" />
                </button>
                <button
                  type="button"
                  onClick={() => setPreviewInput(!previewInput)}
                  className={`flex items-center gap-1 text-xs px-2 py-1 rounded transition-colors ${
                    previewInput
                      ? 'bg-cyan-500/20 text-cyan-400 light:text-cyan-600'
                      : 'bg-slate-700 light:bg-slate-200 text-slate-400 light:text-slate-600 hover:text-slate-300 light:hover:text-slate-800'
                  }`}
                >
                  {previewInput ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                  {previewInput ? tCommon('edit') : t('preview')}
                </button>
              </div>
            </div>
            {previewInput ? (
              <div className="w-full min-h-[80px] px-3 py-2 bg-slate-800 light:bg-slate-50 border border-slate-600 light:border-slate-300 rounded-lg text-sm overflow-auto max-h-48">
                {testCase.input_text ? (
                  <MarkdownRenderer content={testCase.input_text} />
                ) : (
                  <span className="text-slate-500 light:text-slate-400">{t('noContent')}</span>
                )}
              </div>
            ) : (
              <LocalInput
                as="textarea"
                value={testCase.input_text}
                onChange={(value) => handleUpdate({ input_text: value })}
                placeholder={t('enterTestContent')}
                rows={3}
                className="w-full px-3 py-2 bg-slate-800 light:bg-white border border-slate-600 light:border-slate-300 rounded-lg text-slate-200 light:text-slate-800 placeholder-slate-500 light:placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-cyan-500/50 focus:border-cyan-500 resize-y text-sm font-mono min-h-[80px]"
              />
            )}
          </div>

          {variables.length > 0 && (
            <div>
              <label className="block text-sm font-medium text-slate-300 light:text-slate-700 mb-2">
                {t('variableValues')}
              </label>
              <div className="space-y-2">
                {variables.map((varName) => (
                  <div key={varName} className="flex items-center gap-2">
                    <span className="text-xs font-mono text-cyan-400 light:text-cyan-600 w-24 truncate">
                      {`{{${varName}}}`}
                    </span>
                    <LocalInput
                      value={testCase.input_variables[varName] || ''}
                      onChange={(value) => updateVariable(varName, value)}
                      placeholder={t('valueOfVar', { name: varName })}
                      className="flex-1 px-2 py-1 bg-slate-800 light:bg-white border border-slate-600 light:border-slate-300 rounded text-sm text-slate-200 light:text-slate-800 placeholder-slate-500 light:placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-cyan-500/50"
                    />
                  </div>
                ))}
              </div>
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-slate-300 light:text-slate-700 mb-2">
              {t('attachments')}
            </label>
            <div className="space-y-2">
              {testCase.attachments.length > 0 && (
                testCase.attachments.map((attachment, i) => {
                  const Icon = getFileIcon(attachment);
                  return (
                    <div
                      key={i}
                      className="flex items-center gap-2 p-2 bg-slate-800 light:bg-slate-50 rounded border border-slate-700 light:border-slate-200 group"
                    >
                      <button
                        onClick={() => setPreviewAttachment(attachment)}
                        className="flex-1 flex items-center gap-2 min-w-0 hover:text-cyan-400 light:hover:text-cyan-600 transition-colors"
                        title={t('clickToPreview')}
                      >
                        <Icon className="w-4 h-4 text-slate-400 light:text-slate-500 flex-shrink-0" />
                        <span className="text-sm text-slate-300 light:text-slate-700 truncate">
                          {attachment.name}
                        </span>
                        <Eye className="w-3 h-3 text-cyan-400 light:text-cyan-600 flex-shrink-0" />
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          removeAttachment(i);
                        }}
                        className="p-1 hover:bg-slate-700 light:hover:bg-slate-200 rounded transition-colors flex-shrink-0"
                        title={t('deleteAttachment')}
                      >
                        <X className="w-3 h-3 text-slate-500 light:text-slate-400 hover:text-rose-400" />
                      </button>
                    </div>
                  );
                })
              )}
              <input
                ref={fileInputRef}
                type="file"
                onChange={handleFileSelect}
                accept={fileUploadCapabilities?.accept || getFileInputAccept()}
                multiple
                className="hidden"
              />
              <Button
                variant="secondary"
                size="sm"
                onClick={() => fileInputRef.current?.click()}
              >
                <Paperclip className="w-4 h-4" />
                <span>{t('addAttachment')}</span>
              </Button>
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="block text-sm font-medium text-slate-300 light:text-slate-700">
                {t('expectedOutputOptional')}
              </label>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => openExpandModal('expected')}
                  className="flex items-center gap-1 text-xs px-2 py-1 rounded transition-colors bg-slate-700 light:bg-slate-200 text-slate-400 light:text-slate-600 hover:text-slate-300 light:hover:text-slate-800"
                  title={t('expandEdit')}
                >
                  <Maximize2 className="w-3 h-3" />
                </button>
                <button
                  type="button"
                  onClick={() => setPreviewExpected(!previewExpected)}
                  className={`flex items-center gap-1 text-xs px-2 py-1 rounded transition-colors ${
                    previewExpected
                      ? 'bg-cyan-500/20 text-cyan-400 light:text-cyan-600'
                      : 'bg-slate-700 light:bg-slate-200 text-slate-400 light:text-slate-600 hover:text-slate-300 light:hover:text-slate-800'
                  }`}
                >
                  {previewExpected ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                  {previewExpected ? tCommon('edit') : t('preview')}
                </button>
              </div>
            </div>
            {previewExpected ? (
              <div className="w-full min-h-[56px] px-3 py-2 bg-slate-800 light:bg-slate-50 border border-slate-600 light:border-slate-300 rounded-lg text-sm overflow-auto max-h-48">
                {testCase.expected_output ? (
                  <MarkdownRenderer content={testCase.expected_output} />
                ) : (
                  <span className="text-slate-500 light:text-slate-400">{t('noContent')}</span>
                )}
              </div>
            ) : (
              <LocalInput
                as="textarea"
                value={testCase.expected_output || ''}
                onChange={(value) => handleUpdate({ expected_output: value || null })}
                placeholder={t('expectedOutputPlaceholder')}
                rows={2}
                className="w-full px-3 py-2 bg-slate-800 light:bg-white border border-slate-600 light:border-slate-300 rounded-lg text-slate-200 light:text-slate-800 placeholder-slate-500 light:placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-cyan-500/50 focus:border-cyan-500 resize-y text-sm font-mono min-h-[56px]"
              />
            )}
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-300 light:text-slate-700 mb-2">
              {t('notesOptional')}
            </label>
            <LocalInput
              as="textarea"
              value={testCase.notes || ''}
              onChange={(value) => handleUpdate({ notes: value || null })}
              placeholder={t('notesPlaceholder')}
              rows={2}
              className="w-full px-3 py-2 bg-slate-800 light:bg-white border border-slate-600 light:border-slate-300 rounded-lg text-slate-200 light:text-slate-800 placeholder-slate-500 light:placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-cyan-500/50 focus:border-cyan-500 resize-y text-sm min-h-[56px]"
            />
            <p className="text-xs text-slate-500 light:text-slate-600 mt-1">
              {t('notesHint')}
            </p>
          </div>

          <p className="text-xs text-slate-500 light:text-slate-600 flex items-center gap-1">
            <Check className="w-3 h-3" />
            {t('autoSaveHint')}
          </p>
        </div>
      )}

      {/* Expand Modal */}
      <Modal
        isOpen={!!expandedField}
        onClose={closeExpandModal}
        title={expandedField === 'input' ? t('editInputText') : t('editExpectedOutput')}
        size="xl"
      >
        <div className="space-y-4">
          <div className="flex items-center justify-end">
            <button
              type="button"
              onClick={() => setExpandedPreview(!expandedPreview)}
              className={`flex items-center gap-1 text-xs px-3 py-1.5 rounded transition-colors ${
                expandedPreview
                  ? 'bg-cyan-500/20 text-cyan-400 light:text-cyan-600'
                  : 'bg-slate-700 light:bg-slate-200 text-slate-400 light:text-slate-600 hover:text-slate-300 light:hover:text-slate-800'
              }`}
            >
              {expandedPreview ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
              {expandedPreview ? tCommon('edit') : t('preview')}
            </button>
          </div>
          {expandedPreview ? (
            <div className="w-full h-[60vh] px-4 py-3 bg-slate-800 light:bg-slate-50 border border-slate-600 light:border-slate-300 rounded-lg overflow-auto">
              {expandedValue ? (
                <MarkdownRenderer content={expandedValue} />
              ) : (
                <span className="text-slate-500 light:text-slate-400">{t('noContent')}</span>
              )}
            </div>
          ) : (
            <textarea
              value={expandedValue}
              onChange={(e) => setExpandedValue(e.target.value)}
              placeholder={expandedField === 'input' ? t('enterTestContent') : t('expectedOutputPlaceholder')}
              className="w-full h-[60vh] px-4 py-3 bg-slate-800 light:bg-white border border-slate-600 light:border-slate-300 rounded-lg text-slate-200 light:text-slate-800 placeholder-slate-500 light:placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-cyan-500/50 focus:border-cyan-500 resize-none text-sm font-mono"
            />
          )}
          <div className="flex justify-end gap-3">
            <Button variant="ghost" onClick={() => { setExpandedField(null); setExpandedValue(''); setExpandedPreview(false); }}>
              {tCommon('cancel')}
            </Button>
            <Button onClick={closeExpandModal}>
              {tCommon('save')}
            </Button>
          </div>
        </div>
      </Modal>

      {/* Attachment Preview Modal */}
      <AttachmentModal
        attachment={previewAttachment}
        isOpen={!!previewAttachment}
        onClose={() => setPreviewAttachment(null)}
      />
    </div>
  );
}
