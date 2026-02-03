import { useState, useRef, useEffect, type RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import { Trash2, Loader2, Eye, EyeOff, Maximize2, Play, ChevronLeft, ChevronRight, Copy, Check } from 'lucide-react';
import { Button, Modal, MarkdownRenderer } from '../ui';
import { useToast } from '../../store/useUIStore';
import type { TestCase } from '../../types';

interface TestCaseEditorProps {
  testCase: TestCase;
  index: number;
  variables: string[];
  onUpdate: (testCase: TestCase) => Promise<void>;
  onDelete: () => void;
  onRunSingle?: () => void;
  isRunning?: boolean;
  isSelected?: boolean;
  onSelectChange?: (selected: boolean) => void;
  variant?: 'accordion' | 'panel';
  readOnly?: boolean;
}

interface LocalInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  rows?: number;
  as?: 'input' | 'textarea';
  inputRef?: RefObject<HTMLInputElement | HTMLTextAreaElement>;
  disabled?: boolean;
}

function LocalInput({ value, onChange, placeholder, className, rows, as = 'input', inputRef, disabled }: LocalInputProps) {
  const [localValue, setLocalValue] = useState(value);
  const isComposing = useRef(false);

  useEffect(() => {
    if (!isComposing.current) {
      setLocalValue(value);
    }
  }, [value]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    if (disabled) return;
    setLocalValue(e.target.value);
  };

  const handleBlur = () => {
    if (disabled) return;
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
    disabled,
  };

  if (as === 'textarea') {
    return <textarea {...commonProps} rows={rows} ref={inputRef as unknown as RefObject<HTMLTextAreaElement>} />;
  }

  return <input type="text" {...commonProps} ref={inputRef as unknown as RefObject<HTMLInputElement>} />;
}

export function TestCaseEditor({
  testCase,
  index,
  variables,
  onUpdate,
  onDelete,
  onRunSingle,
  isRunning,
  isSelected,
  onSelectChange,
  variant = 'accordion',
  readOnly = false,
}: TestCaseEditorProps) {
  const { showToast } = useToast();
  const { t } = useTranslation('evaluation');
  const { t: tCommon } = useTranslation('common');
  const isPanel = variant === 'panel';
  const [isExpanded, setIsExpanded] = useState(isPanel);
  const [previewInput, setPreviewInput] = useState(false);
  const [previewExpected, setPreviewExpected] = useState(false);
  const [expectedCollapsed, setExpectedCollapsed] = useState(false);
  const [expandedField, setExpandedField] = useState<'input' | 'expected' | null>(null);
  const [expandedValue, setExpandedValue] = useState('');
  const [expandedPreview, setExpandedPreview] = useState(false);
  const [copiedField, setCopiedField] = useState<'input' | 'expected' | null>(null);

  const inputTextRef = useRef<HTMLTextAreaElement | null>(null);
  const expectedOutputRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    if (isPanel) {
      setIsExpanded(true);
    }
  }, [isPanel]);

  useEffect(() => {
    setExpectedCollapsed(false);
  }, [testCase.id]);

  const handleUpdate = async (updates: Partial<TestCase>) => {
    if (readOnly) return;
    await onUpdate({ ...testCase, ...updates });
  };

  const updateVariable = async (varName: string, value: string) => {
    await handleUpdate({
      inputVariables: {
        ...testCase.inputVariables,
        [varName]: value,
      },
    });
  };

  const openExpandModal = (field: 'input' | 'expected') => {
    setExpandedField(field);
    setExpandedValue(field === 'input' ? testCase.inputText : (testCase.expectedOutput || ''));
    setExpandedPreview(readOnly);
  };

  const closeExpandModal = async () => {
    if (readOnly) {
      setExpandedField(null);
      setExpandedValue('');
      setExpandedPreview(false);
      return;
    }
    if (expandedField === 'input') {
      await handleUpdate({ inputText: expandedValue });
    } else if (expandedField === 'expected') {
      await handleUpdate({ expectedOutput: expandedValue || null });
    }
    setExpandedField(null);
    setExpandedValue('');
    setExpandedPreview(false);
  };

  const handleCopy = async (field: 'input' | 'expected') => {
    const text = field === 'input'
      ? (previewInput ? testCase.inputText : (inputTextRef.current?.value ?? testCase.inputText))
      : (previewExpected ? (testCase.expectedOutput || '') : (expectedOutputRef.current?.value ?? (testCase.expectedOutput || '')));

    if (!text.trim()) return;

    try {
      await navigator.clipboard.writeText(text);
      setCopiedField(field);
      showToast('success', tCommon('copied'));
      window.setTimeout(() => setCopiedField((prev) => (prev === field ? null : prev)), 1200);
    } catch {
      showToast('error', tCommon('error'));
    }
  };

  const isContentVisible = isPanel ? true : isExpanded;

  return (
    <div className={`border border-slate-700 light:border-slate-200 rounded-lg bg-slate-800/30 light:bg-white overflow-hidden light:shadow-sm ${isPanel ? 'h-full flex flex-col' : ''}`}>
      {!isPanel && (
        <div
          role="button"
          tabIndex={0}
          aria-expanded={isExpanded}
          onClick={() => setIsExpanded(!isExpanded)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              setIsExpanded((prev) => !prev);
            }
          }}
          className="w-full flex items-center justify-between p-4 hover:bg-slate-800/50 light:hover:bg-slate-50 transition-colors cursor-pointer focus:outline-none focus:ring-2 focus:ring-cyan-500/40"
        >
          <div className="flex items-center gap-3">
            {onSelectChange && (
              <input
                type="checkbox"
                checked={!!isSelected}
                onClick={(e) => e.stopPropagation()}
                onChange={(e) => {
                  if (readOnly) return;
                  onSelectChange(e.target.checked);
                }}
                disabled={readOnly}
                className="w-4 h-4 accent-cyan-500"
                aria-label={t('selectTestCase')}
              />
            )}
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
                disabled={readOnly || isRunning}
                title={t('runThisCase')}
              >
                {isRunning ? (
                  <Loader2 className="w-4 h-4 text-cyan-400 animate-spin" />
                ) : (
                  <Play className="w-4 h-4 text-slate-500 light:text-slate-400 hover:text-cyan-400" />
                )}
              </Button>
            )}
            {!readOnly && (
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
            )}
          </div>
        </div>
      )}

      {isContentVisible && (
        <div className={`p-3 ${isPanel ? '' : 'pt-0'} flex flex-col gap-4 ${isPanel ? 'flex-1 min-h-0 overflow-y-auto' : ''} ${isPanel ? '' : 'border-t border-slate-700/50 light:border-slate-200'}`}>
          <div className="flex flex-col lg:flex-row gap-4 flex-1 min-h-0">
            <div className="rounded-lg border border-slate-700/60 light:border-slate-200 bg-slate-900/40 light:bg-slate-50 p-3 flex flex-col flex-1 min-h-0">
              <div className="flex items-center justify-between mb-2">
                <label className="block text-sm font-medium text-slate-300 light:text-slate-700">
                  {t('inputText')}
                </label>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => void handleCopy('input')}
                    disabled={!(previewInput ? testCase.inputText : (inputTextRef.current?.value ?? testCase.inputText)).trim()}
                    className="flex items-center gap-1 text-xs px-2 py-1 rounded transition-colors bg-slate-700 light:bg-slate-200 text-slate-400 light:text-slate-600 hover:text-slate-300 light:hover:text-slate-800 disabled:opacity-50 disabled:cursor-not-allowed"
                    title={tCommon('copy')}
                    aria-label={tCommon('copy')}
                  >
                    {copiedField === 'input' ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                  </button>
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
                <div className="flex-1 min-h-0 w-full px-3 py-2 bg-slate-800 light:bg-slate-50 border border-slate-600 light:border-slate-300 rounded-lg text-sm overflow-auto">
                  {testCase.inputText ? (
                    <MarkdownRenderer content={testCase.inputText} />
                  ) : (
                    <span className="text-slate-500 light:text-slate-400">{t('noContent')}</span>
                  )}
                </div>
              ) : (
                <LocalInput
                  as="textarea"
                  value={testCase.inputText}
                  onChange={(value) => handleUpdate({ inputText: value })}
                  placeholder={t('enterTestContent')}
                  rows={8}
                  disabled={readOnly}
                  inputRef={inputTextRef as unknown as RefObject<HTMLInputElement | HTMLTextAreaElement>}
                  className="flex-1 min-h-0 w-full px-3 py-2 bg-slate-800 light:bg-white border border-slate-600 light:border-slate-300 rounded-lg text-slate-200 light:text-slate-800 placeholder-slate-500 light:placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-cyan-500/50 focus:border-cyan-500 resize-none text-sm font-mono"
                />
              )}
            </div>

            <div
              className={`rounded-lg border border-slate-700/60 light:border-slate-200 bg-slate-900/40 light:bg-slate-50 p-3 flex flex-col flex-1 min-h-0 ${
                expectedCollapsed ? 'lg:hidden' : ''
              }`}
            >
              <div className="flex items-center justify-between mb-2">
                <label className="block text-sm font-medium text-slate-300 light:text-slate-700">
                  {t('expectedOutputOptional')}
                </label>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => void handleCopy('expected')}
                    disabled={!(previewExpected ? (testCase.expectedOutput || '') : (expectedOutputRef.current?.value ?? (testCase.expectedOutput || ''))).trim()}
                    className="flex items-center gap-1 text-xs px-2 py-1 rounded transition-colors bg-slate-700 light:bg-slate-200 text-slate-400 light:text-slate-600 hover:text-slate-300 light:hover:text-slate-800 disabled:opacity-50 disabled:cursor-not-allowed"
                    title={tCommon('copy')}
                    aria-label={tCommon('copy')}
                  >
                    {copiedField === 'expected' ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                  </button>
                  <button
                    type="button"
                    onClick={() => setExpectedCollapsed(true)}
                    className="hidden lg:flex items-center gap-1 text-xs px-2 py-1 rounded transition-colors bg-slate-700 light:bg-slate-200 text-slate-400 light:text-slate-600 hover:text-slate-300 light:hover:text-slate-800"
                    title={tCommon('collapse')}
                    aria-label={tCommon('collapse')}
                  >
                    <ChevronRight className="w-3 h-3" />
                  </button>
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
                <div className="flex-1 min-h-0 w-full px-3 py-2 bg-slate-800 light:bg-slate-50 border border-slate-600 light:border-slate-300 rounded-lg text-sm overflow-auto">
                  {testCase.expectedOutput ? (
                    <MarkdownRenderer content={testCase.expectedOutput} />
                  ) : (
                    <span className="text-slate-500 light:text-slate-400">{t('noContent')}</span>
                  )}
                </div>
              ) : (
                <LocalInput
                  as="textarea"
                  value={testCase.expectedOutput || ''}
                  onChange={(value) => handleUpdate({ expectedOutput: value || null })}
                  placeholder={t('expectedOutputPlaceholder')}
                  rows={8}
                  disabled={readOnly}
                  inputRef={expectedOutputRef as unknown as RefObject<HTMLInputElement | HTMLTextAreaElement>}
                  className="flex-1 min-h-0 w-full px-3 py-2 bg-slate-800 light:bg-white border border-slate-600 light:border-slate-300 rounded-lg text-slate-200 light:text-slate-800 placeholder-slate-500 light:placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-cyan-500/50 focus:border-cyan-500 resize-none text-sm font-mono"
                />
              )}
            </div>

            {expectedCollapsed && (
              <div className="hidden lg:flex w-10 rounded-lg border border-slate-700/60 light:border-slate-200 bg-slate-900/40 light:bg-slate-50 overflow-hidden">
                <button
                  type="button"
                  onClick={() => setExpectedCollapsed(false)}
                  className="w-full h-full flex flex-col items-center justify-center gap-2 text-slate-400 light:text-slate-500 hover:text-cyan-400 light:hover:text-cyan-700 transition-colors"
                  title={tCommon('expand')}
                  aria-label={tCommon('expand')}
                >
                  <ChevronLeft className="w-4 h-4" />
                  <span
                    className="text-[11px] font-medium"
                    style={{ writingMode: 'vertical-rl', textOrientation: 'mixed' }}
                  >
                    {t('expectedOutput')}
                  </span>
                </button>
              </div>
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
                      value={testCase.inputVariables[varName] || ''}
                      onChange={(value) => updateVariable(varName, value)}
                      placeholder={t('valueOfVar', { name: varName })}
                      disabled={readOnly}
                      className="flex-1 px-2 py-1 bg-slate-800 light:bg-white border border-slate-600 light:border-slate-300 rounded text-sm text-slate-200 light:text-slate-800 placeholder-slate-500 light:placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-cyan-500/50"
                    />
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="rounded-lg border border-slate-700/60 light:border-slate-200 bg-slate-900/40 light:bg-slate-50 p-3">
            <label className="block text-sm font-medium text-slate-300 light:text-slate-700 mb-2">
              {t('notesOptional')}
            </label>
            <LocalInput
              as="textarea"
              value={testCase.notes || ''}
              onChange={(value) => handleUpdate({ notes: value || null })}
              placeholder={t('notesPlaceholder')}
              rows={4}
              disabled={readOnly}
              className="w-full px-3 py-2 bg-slate-800 light:bg-white border border-slate-600 light:border-slate-300 rounded-lg text-slate-200 light:text-slate-800 placeholder-slate-500 light:placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-cyan-500/50 focus:border-cyan-500 resize-y text-sm min-h-[96px]"
            />
            <p className="text-xs text-slate-500 light:text-slate-600 mt-1">
              {t('notesHint')}
            </p>
          </div>
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
              onChange={(e) => {
                if (readOnly) return;
                setExpandedValue(e.target.value);
              }}
              placeholder={expandedField === 'input' ? t('enterTestContent') : t('expectedOutputPlaceholder')}
              readOnly={readOnly}
              className="w-full h-[60vh] px-4 py-3 bg-slate-800 light:bg-white border border-slate-600 light:border-slate-300 rounded-lg text-slate-200 light:text-slate-800 placeholder-slate-500 light:placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-cyan-500/50 focus:border-cyan-500 resize-none text-sm font-mono"
            />
          )}
          <div className="flex justify-end">
            <Button variant="secondary" onClick={closeExpandModal}>
              {tCommon('close')}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
