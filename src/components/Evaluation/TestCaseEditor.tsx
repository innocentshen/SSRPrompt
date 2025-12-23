import { useState, useRef, useEffect } from 'react';
import { Trash2, Paperclip, X, FileText, Image, Check, Loader2, Eye, EyeOff, Maximize2, Code, File } from 'lucide-react';
import { Button, Modal, MarkdownRenderer } from '../ui';
import type { TestCase, FileAttachmentData } from '../../types';
import { getFileInputAccept, isSupportedFileType, getFileIconType, isImageFile, isPdfFile, isTextFile, readTextContent, getSyntaxLanguage } from '../../lib/file-utils';

interface TestCaseEditorProps {
  testCase: TestCase;
  index: number;
  variables: string[];
  onUpdate: (testCase: TestCase) => Promise<void>;
  onDelete: () => void;
  isSaving?: boolean;
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
  isSaving,
}: TestCaseEditorProps) {
  const [isExpanded, setIsExpanded] = useState(true);
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
      const base64 = await fileToBase64(file);
      newAttachments.push({
        name: file.name,
        type: file.type,
        base64,
      });
    }

    await handleUpdate({
      attachments: [...testCase.attachments, ...newAttachments],
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
    await handleUpdate({
      attachments: testCase.attachments.filter((_, i) => i !== attachmentIndex),
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

  const renderAttachmentPreview = (attachment: FileAttachmentData) => {
    if (isImageFile(attachment)) {
      return (
        <div className="flex items-center justify-center h-full">
          <img
            src={`data:${attachment.type};base64,${attachment.base64}`}
            alt={attachment.name}
            className="max-w-full max-h-[70vh] object-contain"
          />
        </div>
      );
    }
    if (isPdfFile(attachment)) {
      return (
        <iframe
          src={`data:application/pdf;base64,${attachment.base64}`}
          className="w-full h-[70vh]"
          title={attachment.name}
        />
      );
    }
    if (isTextFile(attachment)) {
      const textContent = readTextContent(attachment.base64);
      const language = getSyntaxLanguage(attachment);
      return (
        <div className="h-[70vh] overflow-auto">
          <pre className="p-4 bg-slate-900 light:bg-slate-100 rounded-lg text-sm font-mono text-slate-300 light:text-slate-700 whitespace-pre-wrap break-words">
            <code className={`language-${language}`}>{textContent}</code>
          </pre>
        </div>
      );
    }
    return (
      <div className="flex items-center justify-center h-[200px] text-slate-500 light:text-slate-600">
        无法预览此文件类型
      </div>
    );
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
            {testCase.name || `测试用例 #${index + 1}`}
          </span>
          {testCase.attachments.length > 0 && (
            <span className="text-xs text-slate-500 light:text-slate-600">
              ({testCase.attachments.length} 个附件)
            </span>
          )}
          {showSaving ? (
            <span className="flex items-center gap-1 text-xs text-amber-400 light:text-amber-600">
              <Loader2 className="w-3 h-3 animate-spin" />
              保存中...
            </span>
          ) : (
            <span className="flex items-center gap-1 text-xs text-emerald-400 light:text-emerald-600">
              <Check className="w-3 h-3" />
              已保存
            </span>
          )}
        </div>
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
      </button>

      {isExpanded && (
        <div className="p-4 pt-0 space-y-4 border-t border-slate-700/50 light:border-slate-200">
          <div>
            <label className="block text-sm font-medium text-slate-300 light:text-slate-700 mb-2">
              用例名称
            </label>
            <LocalInput
              value={testCase.name}
              onChange={(value) => handleUpdate({ name: value })}
              placeholder="给测试用例起个名字"
              className="w-full px-3 py-2 bg-slate-800 light:bg-white border border-slate-600 light:border-slate-300 rounded-lg text-slate-200 light:text-slate-800 placeholder-slate-500 light:placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-cyan-500/50 focus:border-cyan-500 text-sm"
            />
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="block text-sm font-medium text-slate-300 light:text-slate-700">
                输入文本
              </label>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => openExpandModal('input')}
                  className="flex items-center gap-1 text-xs px-2 py-1 rounded transition-colors bg-slate-700 light:bg-slate-200 text-slate-400 light:text-slate-600 hover:text-slate-300 light:hover:text-slate-800"
                  title="放大编辑"
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
                  {previewInput ? '编辑' : '预览'}
                </button>
              </div>
            </div>
            {previewInput ? (
              <div className="w-full min-h-[80px] px-3 py-2 bg-slate-800 light:bg-slate-50 border border-slate-600 light:border-slate-300 rounded-lg text-sm overflow-auto max-h-48">
                {testCase.input_text ? (
                  <MarkdownRenderer content={testCase.input_text} />
                ) : (
                  <span className="text-slate-500 light:text-slate-400">无内容</span>
                )}
              </div>
            ) : (
              <LocalInput
                as="textarea"
                value={testCase.input_text}
                onChange={(value) => handleUpdate({ input_text: value })}
                placeholder="输入要测试的文本内容..."
                rows={3}
                className="w-full px-3 py-2 bg-slate-800 light:bg-white border border-slate-600 light:border-slate-300 rounded-lg text-slate-200 light:text-slate-800 placeholder-slate-500 light:placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-cyan-500/50 focus:border-cyan-500 resize-y text-sm font-mono min-h-[80px]"
              />
            )}
          </div>

          {variables.length > 0 && (
            <div>
              <label className="block text-sm font-medium text-slate-300 light:text-slate-700 mb-2">
                变量值
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
                      placeholder={`${varName} 的值`}
                      className="flex-1 px-2 py-1 bg-slate-800 light:bg-white border border-slate-600 light:border-slate-300 rounded text-sm text-slate-200 light:text-slate-800 placeholder-slate-500 light:placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-cyan-500/50"
                    />
                  </div>
                ))}
              </div>
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-slate-300 light:text-slate-700 mb-2">
              附件
            </label>
            <div className="space-y-2">
              {testCase.attachments.map((attachment, i) => {
                const Icon = getFileIcon(attachment);
                return (
                  <div
                    key={i}
                    className="flex items-center gap-2 p-2 bg-slate-800 light:bg-slate-50 rounded border border-slate-700 light:border-slate-200"
                  >
                    <Icon className="w-4 h-4 text-slate-400 light:text-slate-500" />
                    <span className="flex-1 text-sm text-slate-300 light:text-slate-700 truncate">
                      {attachment.name}
                    </span>
                    <button
                      onClick={() => setPreviewAttachment(attachment)}
                      className="p-1 hover:bg-slate-700 light:hover:bg-slate-200 rounded transition-colors"
                      title="预览附件"
                    >
                      <Eye className="w-3 h-3 text-slate-500 light:text-slate-400 hover:text-cyan-400 light:hover:text-cyan-600" />
                    </button>
                    <button
                      onClick={() => removeAttachment(i)}
                      className="p-1 hover:bg-slate-700 light:hover:bg-slate-200 rounded transition-colors"
                      title="删除附件"
                    >
                      <X className="w-3 h-3 text-slate-500 light:text-slate-400 hover:text-rose-400" />
                    </button>
                  </div>
                );
              })}
              <input
                ref={fileInputRef}
                type="file"
                onChange={handleFileSelect}
                accept={getFileInputAccept()}
                multiple
                className="hidden"
              />
              <Button
                variant="secondary"
                size="sm"
                onClick={() => fileInputRef.current?.click()}
              >
                <Paperclip className="w-4 h-4" />
                <span>添加附件</span>
              </Button>
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="block text-sm font-medium text-slate-300 light:text-slate-700">
                期望输出 (可选)
              </label>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => openExpandModal('expected')}
                  className="flex items-center gap-1 text-xs px-2 py-1 rounded transition-colors bg-slate-700 light:bg-slate-200 text-slate-400 light:text-slate-600 hover:text-slate-300 light:hover:text-slate-800"
                  title="放大编辑"
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
                  {previewExpected ? '编辑' : '预览'}
                </button>
              </div>
            </div>
            {previewExpected ? (
              <div className="w-full min-h-[56px] px-3 py-2 bg-slate-800 light:bg-slate-50 border border-slate-600 light:border-slate-300 rounded-lg text-sm overflow-auto max-h-48">
                {testCase.expected_output ? (
                  <MarkdownRenderer content={testCase.expected_output} />
                ) : (
                  <span className="text-slate-500 light:text-slate-400">无内容</span>
                )}
              </div>
            ) : (
              <LocalInput
                as="textarea"
                value={testCase.expected_output || ''}
                onChange={(value) => handleUpdate({ expected_output: value || null })}
                placeholder="期望的模型输出，用于对比评估..."
                rows={2}
                className="w-full px-3 py-2 bg-slate-800 light:bg-white border border-slate-600 light:border-slate-300 rounded-lg text-slate-200 light:text-slate-800 placeholder-slate-500 light:placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-cyan-500/50 focus:border-cyan-500 resize-y text-sm font-mono min-h-[56px]"
              />
            )}
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-300 light:text-slate-700 mb-2">
              备注 (可选)
            </label>
            <LocalInput
              as="textarea"
              value={testCase.notes || ''}
              onChange={(value) => handleUpdate({ notes: value || null })}
              placeholder="添加备注信息，如测试目的、注意事项等（不会发送给 AI）..."
              rows={2}
              className="w-full px-3 py-2 bg-slate-800 light:bg-white border border-slate-600 light:border-slate-300 rounded-lg text-slate-200 light:text-slate-800 placeholder-slate-500 light:placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-cyan-500/50 focus:border-cyan-500 resize-y text-sm min-h-[56px]"
            />
            <p className="text-xs text-slate-500 light:text-slate-600 mt-1">
              备注内容仅供参考，不会在评测时发送给 AI
            </p>
          </div>

          <p className="text-xs text-slate-500 light:text-slate-600 flex items-center gap-1">
            <Check className="w-3 h-3" />
            输入内容在失焦时自动保存
          </p>
        </div>
      )}

      {/* Expand Modal */}
      <Modal
        isOpen={!!expandedField}
        onClose={closeExpandModal}
        title={expandedField === 'input' ? '编辑输入文本' : '编辑期望输出'}
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
              {expandedPreview ? '编辑' : '预览'}
            </button>
          </div>
          {expandedPreview ? (
            <div className="w-full h-[60vh] px-4 py-3 bg-slate-800 light:bg-slate-50 border border-slate-600 light:border-slate-300 rounded-lg overflow-auto">
              {expandedValue ? (
                <MarkdownRenderer content={expandedValue} />
              ) : (
                <span className="text-slate-500 light:text-slate-400">无内容</span>
              )}
            </div>
          ) : (
            <textarea
              value={expandedValue}
              onChange={(e) => setExpandedValue(e.target.value)}
              placeholder={expandedField === 'input' ? '输入要测试的文本内容...' : '期望的模型输出，用于对比评估...'}
              className="w-full h-[60vh] px-4 py-3 bg-slate-800 light:bg-white border border-slate-600 light:border-slate-300 rounded-lg text-slate-200 light:text-slate-800 placeholder-slate-500 light:placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-cyan-500/50 focus:border-cyan-500 resize-none text-sm font-mono"
            />
          )}
          <div className="flex justify-end gap-3">
            <Button variant="ghost" onClick={() => { setExpandedField(null); setExpandedValue(''); setExpandedPreview(false); }}>
              取消
            </Button>
            <Button onClick={closeExpandModal}>
              保存
            </Button>
          </div>
        </div>
      </Modal>

      {/* Attachment Preview Modal */}
      <Modal
        isOpen={!!previewAttachment}
        onClose={() => setPreviewAttachment(null)}
        title={previewAttachment?.name || '附件预览'}
        size="xl"
      >
        {previewAttachment && renderAttachmentPreview(previewAttachment)}
      </Modal>
    </div>
  );
}
