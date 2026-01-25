import { useMemo, useState, useEffect, useRef } from 'react';
import { Plus, Search, Play, Trash2, Copy, Loader2, Paperclip, X, Eye, Pencil, FileText, Image, Code, File } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button, Modal } from '../ui';
import { TestCaseEditor } from './TestCaseEditor';
import { AttachmentModal } from '../Prompt/AttachmentModal';
import type { TestCase, FileAttachment } from '../../types';
import { getFileInputAccept, isSupportedFileType, getFileIconType } from '../../lib/file-utils';
import { uploadFileAttachment } from '../../lib/ai-service';

interface FileUploadCapabilities {
  accept: string;
  canUploadImage: boolean;
  canUploadPdf: boolean;
  canUploadText: boolean;
}

interface TestCaseListProps {
  testCases: TestCase[];
  variables: string[];
  onAdd: () => Promise<TestCase | null>;
  onUpdate: (testCase: TestCase) => Promise<void>;
  onDelete: (id: string) => void;
  onCopy?: (testCase: TestCase) => Promise<TestCase | null>;
  onDeleteSelected?: (ids: string[]) => void;
  onRunSelected?: () => void;
  runningTestCaseId?: string | null;
  selectedTestCaseIds?: Set<string>;
  onToggleSelect?: (id: string, selected: boolean) => void;
  onSetSelectedIds?: (ids: Set<string>) => void;
  fileUploadCapabilities?: FileUploadCapabilities;
}

export function TestCaseList({
  testCases,
  variables,
  onAdd,
  onUpdate,
  onDelete,
  onCopy,
  onDeleteSelected,
  onRunSelected,
  runningTestCaseId,
  selectedTestCaseIds,
  onToggleSelect,
  onSetSelectedIds,
  fileUploadCapabilities,
}: TestCaseListProps) {
  const { t } = useTranslation('evaluation');
  const { t: tCommon } = useTranslation('common');
  const [query, setQuery] = useState('');
  const [activeTestCaseId, setActiveTestCaseId] = useState<string | null>(testCases[0]?.id ?? null);
  const [nameDraft, setNameDraft] = useState('');
  const [isEditingName, setIsEditingName] = useState(false);
  const isComposingName = useRef(false);
  const nameInputRef = useRef<HTMLInputElement>(null);
  const [attachmentsOpen, setAttachmentsOpen] = useState(false);
  const [previewAttachment, setPreviewAttachment] = useState<FileAttachment | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const filteredTestCases = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return testCases;
    return testCases.filter((testCase) => {
      const name = testCase.name?.toLowerCase() ?? '';
      const inputText = testCase.inputText?.toLowerCase() ?? '';
      const notes = testCase.notes?.toLowerCase() ?? '';
      return name.includes(normalized) || inputText.includes(normalized) || notes.includes(normalized);
    });
  }, [testCases, query]);

  useEffect(() => {
    if (filteredTestCases.length === 0) {
      if (activeTestCaseId !== null) {
        setActiveTestCaseId(null);
      }
      return;
    }
    if (!activeTestCaseId || !filteredTestCases.some((testCase) => testCase.id === activeTestCaseId)) {
      setActiveTestCaseId(filteredTestCases[0].id);
    }
  }, [filteredTestCases, activeTestCaseId]);

  const selectedSet = selectedTestCaseIds ?? new Set<string>();
  const selectedCount = selectedSet.size;
  const allFilteredSelected =
    filteredTestCases.length > 0 && filteredTestCases.every((testCase) => selectedSet.has(testCase.id));

  const activeTestCase = testCases.find((testCase) => testCase.id === activeTestCaseId) || null;
  const activeIndex = activeTestCase ? testCases.findIndex((testCase) => testCase.id === activeTestCase.id) : 0;

  useEffect(() => {
    setNameDraft(activeTestCase?.name ?? '');
    setIsEditingName(false);
  }, [activeTestCase?.id, activeTestCase?.name]);

  useEffect(() => {
    setAttachmentsOpen(false);
  }, [activeTestCase?.id]);

  useEffect(() => {
    if (!isEditingName) return;
    nameInputRef.current?.focus();
    nameInputRef.current?.select();
  }, [isEditingName]);

  const commitNameUpdate = () => {
    if (!activeTestCase) return;
    if (nameDraft === activeTestCase.name) return;
    void onUpdate({ ...activeTestCase, name: nameDraft });
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

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!activeTestCase) return;
    const files = e.target.files;
    if (!files || files.length === 0) return;
    if (isUploading) return;

    const maxSize = 20 * 1024 * 1024;
    const newAttachments: FileAttachment[] = [];

    setIsUploading(true);
    try {
      for (const file of Array.from(files)) {
        if (!isSupportedFileType(file)) {
          continue;
        }
        if (file.size > maxSize) {
          continue;
        }

        try {
          const attachment = await uploadFileAttachment(file);
          newAttachments.push(attachment);
        } catch {
          // ignore per-file failures
        }
      }

      if (newAttachments.length > 0) {
        await onUpdate({ ...activeTestCase, attachments: [...activeTestCase.attachments, ...newAttachments] });
      }
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const removeAttachment = async (attachmentIndex: number) => {
    if (!activeTestCase) return;
    await onUpdate({
      ...activeTestCase,
      attachments: activeTestCase.attachments.filter((_, i) => i !== attachmentIndex),
    });
  };

  const handleSelectAll = () => {
    if (!onSetSelectedIds && !onToggleSelect) return;
    if (filteredTestCases.length === 0) return;
    if (allFilteredSelected) {
      if (onSetSelectedIds) {
        onSetSelectedIds(new Set());
      } else {
        filteredTestCases.forEach((testCase) => onToggleSelect?.(testCase.id, false));
      }
      return;
    }
    const next = new Set(filteredTestCases.map((testCase) => testCase.id));
    if (onSetSelectedIds) {
      onSetSelectedIds(next);
    } else {
      filteredTestCases.forEach((testCase) => onToggleSelect?.(testCase.id, true));
    }
  };

  const handleAdd = async () => {
    const created = await onAdd();
    if (created?.id) {
      setActiveTestCaseId(created.id);
    }
  };

  const handleCopyActive = async () => {
    if (!activeTestCase || !onCopy) return;
    const created = await onCopy(activeTestCase);
    if (created?.id) {
      setActiveTestCaseId(created.id);
    }
  };

  const handleDeleteSelected = () => {
    if (!onDeleteSelected || selectedCount === 0) return;
    onDeleteSelected(Array.from(selectedSet));
  };

  return (
    <>
    <div className="grid gap-4 lg:grid-cols-[300px_minmax(0,1fr)] h-full min-h-0 lg:grid-rows-[minmax(0,1fr)]">
      <div className="flex flex-col gap-3 rounded-xl border border-slate-700/60 light:border-slate-200 bg-slate-900/30 light:bg-white p-3 shadow-sm h-full min-h-0">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-medium text-slate-300 light:text-slate-700">
            {t('testCases')} ({selectedCount > 0 ? `${selectedCount}/${testCases.length}` : testCases.length})
          </h3>
        </div>

        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500 light:text-slate-400" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('searchTestCases')}
              aria-label={t('searchTestCases')}
              className="w-full pl-7 pr-2 py-1.5 bg-slate-800 light:bg-slate-50 border border-slate-700 light:border-slate-300 rounded-md text-xs text-slate-200 light:text-slate-800 placeholder-slate-500 light:placeholder-slate-400 focus:outline-none focus:border-cyan-500"
            />
          </div>
          <Button variant="secondary" size="sm" onClick={handleAdd} className="shrink-0">
            <Plus className="w-4 h-4" />
            <span>{t('addTestCase')}</span>
          </Button>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button variant="ghost" size="sm" onClick={handleSelectAll} disabled={filteredTestCases.length === 0}>
            {tCommon('selectAll')}
          </Button>
          <Button variant="ghost" size="sm" onClick={handleDeleteSelected} disabled={selectedCount === 0}>
            <Trash2 className="w-4 h-4" />
            <span>{tCommon('delete')}</span>
          </Button>
          {onRunSelected && (
            <Button variant="secondary" size="sm" onClick={onRunSelected} disabled={testCases.length === 0}>
              <Play className="w-4 h-4" />
              <span>{t('runEvaluation')}</span>
            </Button>
          )}
        </div>

        {testCases.length === 0 ? (
          <div className="text-center py-8 text-slate-500 light:text-slate-600 text-sm border border-dashed border-slate-700 light:border-slate-300 rounded-lg">
            <p>{t('noTestCases')}</p>
            <p className="text-xs mt-1">{t('clickAddFirstTest')}</p>
          </div>
        ) : filteredTestCases.length === 0 ? (
          <div className="text-center py-8 text-slate-500 light:text-slate-600 text-sm border border-dashed border-slate-700 light:border-slate-300 rounded-lg">
            <p>{t('noMatchingTestCases')}</p>
          </div>
        ) : (
          <div className="space-y-2 flex-1 min-h-0 overflow-y-auto pr-1">
            {filteredTestCases.map((testCase, index) => {
              const isActive = testCase.id === activeTestCaseId;
              const isSelected = selectedSet.has(testCase.id);
              const isRunning = runningTestCaseId === testCase.id;
              return (
                <button
                  key={testCase.id}
                  type="button"
                  onClick={() => setActiveTestCaseId(testCase.id)}
                  className={`w-full text-left border rounded-lg px-3 py-2 transition-colors ${
                    isActive
                      ? 'border-cyan-500/50 bg-cyan-500/10'
                      : 'border-slate-700/80 bg-slate-800/40 hover:bg-slate-800/60 light:bg-white light:border-slate-200 light:hover:bg-slate-50'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      {onToggleSelect && (
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onClick={(e) => e.stopPropagation()}
                          onChange={(e) => onToggleSelect(testCase.id, e.target.checked)}
                          className="w-4 h-4 accent-cyan-500"
                          aria-label={t('selectTestCase')}
                        />
                      )}
                      <span className="text-xs text-slate-500 light:text-slate-500">{index + 1}</span>
                      <span className="text-sm font-medium text-slate-200 light:text-slate-800 truncate">
                        {testCase.name || t('testCaseNum', { num: index + 1 })}
                      </span>
                    </div>
                    {isRunning && <Loader2 className="w-3.5 h-3.5 text-cyan-400 animate-spin" />}
                  </div>
                  {testCase.attachments.length > 0 && (
                    <div className="mt-1 text-xs text-slate-500 light:text-slate-600">
                      {t('attachmentsCount', { count: testCase.attachments.length })}
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        )}
      </div>

      <div className="flex flex-col gap-3 rounded-xl border border-slate-700/60 light:border-slate-200 bg-slate-900/30 light:bg-white p-3 shadow-sm h-full min-h-0">
        {activeTestCase ? (
          <>
            <div className="flex flex-wrap lg:flex-nowrap items-center justify-between gap-2 rounded-lg border border-slate-700/60 light:border-slate-200 bg-slate-900/40 light:bg-slate-50 px-2 py-1">
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-xs text-slate-500 light:text-slate-600 shrink-0">{t('testCaseName')}</span>
                {isEditingName ? (
                  <input
                    ref={nameInputRef}
                    value={nameDraft}
                    onChange={(e) => setNameDraft(e.target.value)}
                    onBlur={() => {
                      if (!isComposingName.current) {
                        commitNameUpdate();
                      }
                      setIsEditingName(false);
                    }}
                    onCompositionStart={() => {
                      isComposingName.current = true;
                    }}
                    onCompositionEnd={(e) => {
                      isComposingName.current = false;
                      setNameDraft(e.currentTarget.value);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !isComposingName.current) {
                        e.preventDefault();
                        e.currentTarget.blur();
                      }
                      if (e.key === 'Escape' && !isComposingName.current) {
                        e.preventDefault();
                        setNameDraft(activeTestCase.name ?? '');
                        setIsEditingName(false);
                      }
                    }}
                    placeholder={t('testCaseNum', { num: activeIndex + 1 })}
                    className="w-full lg:w-[420px] min-w-0 px-2 py-0.5 bg-slate-800 light:bg-white border border-slate-600 light:border-slate-300 rounded-md text-sm text-slate-200 light:text-slate-800 placeholder-slate-500 light:placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-cyan-500/40 focus:border-cyan-500"
                  />
                ) : (
                  <button
                    type="button"
                    onClick={() => setIsEditingName(true)}
                    className="flex items-center gap-1 px-2 py-0.5 rounded-md hover:bg-slate-800/40 light:hover:bg-slate-200/60 transition-colors max-w-full lg:max-w-[420px] min-w-0"
                    title={nameDraft || t('testCaseNum', { num: activeIndex + 1 })}
                  >
                    <span className="text-sm font-medium text-slate-200 light:text-slate-800 truncate">
                      {nameDraft || t('testCaseNum', { num: activeIndex + 1 })}
                    </span>
                    <Pencil className="w-3.5 h-3.5 text-slate-500 light:text-slate-500 shrink-0" />
                  </button>
                )}
              </div>
              <div className="flex items-center gap-2 min-w-0">
                <Button
                  variant="ghost"
                  size="sm"
                  className="px-2 py-1"
                  onClick={() => setAttachmentsOpen(true)}
                  title={t('attachments')}
                >
                  <Paperclip className="w-4 h-4" />
                  {activeTestCase.attachments.length > 0 && (
                    <span className="text-xs text-slate-400 light:text-slate-600">
                      {activeTestCase.attachments.length}
                    </span>
                  )}
                </Button>
                {activeTestCase.attachments.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setPreviewAttachment(activeTestCase.attachments[0])}
                    className="hidden lg:flex items-center gap-1 px-2 py-1 rounded-md border border-slate-700/60 light:border-slate-200 bg-slate-800/40 light:bg-white text-xs text-slate-300 light:text-slate-700 hover:border-cyan-500/50 hover:text-cyan-300 light:hover:text-cyan-700 max-w-[220px]"
                    title={activeTestCase.attachments[0].name}
                  >
                    {(() => {
                      const Icon = getFileIcon(activeTestCase.attachments[0]);
                      return <Icon className="w-3.5 h-3.5 text-slate-400 light:text-slate-500" />;
                    })()}
                    <span className="truncate">{activeTestCase.attachments[0].name}</span>
                  </button>
                )}
                {activeTestCase.attachments.length > 1 && (
                  <button
                    type="button"
                    onClick={() => setAttachmentsOpen(true)}
                    className="hidden lg:inline-flex text-xs px-1.5 py-1 rounded-md border border-slate-700/60 light:border-slate-200 bg-slate-800/30 light:bg-white text-slate-400 light:text-slate-600 hover:border-cyan-500/50 hover:text-cyan-300 light:hover:text-cyan-700 transition-colors"
                  >
                    +{activeTestCase.attachments.length - 1}
                  </button>
                )}
                <Button
                  variant="secondary"
                  size="sm"
                  className="px-2 py-1"
                  onClick={handleCopyActive}
                  disabled={!onCopy}
                >
                  <Copy className="w-4 h-4" />
                  <span>{tCommon('copy')}</span>
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="px-2 py-1"
                  onClick={() => onDelete(activeTestCase.id)}
                >
                  <Trash2 className="w-4 h-4" />
                  <span>{tCommon('delete')}</span>
                </Button>
              </div>
            </div>

            <div className="flex-1 min-h-0">
              <TestCaseEditor
                testCase={activeTestCase}
                index={activeIndex}
                variables={variables}
                onUpdate={onUpdate}
                onDelete={() => onDelete(activeTestCase.id)}
                variant="panel"
              />
            </div>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center text-slate-500 light:text-slate-600 text-sm border border-dashed border-slate-700 light:border-slate-300 rounded-lg">
            {testCases.length === 0 ? t('noTestCases') : t('noMatchingTestCases')}
          </div>
        )}
      </div>
    </div>

    <Modal
      isOpen={attachmentsOpen && !!activeTestCase}
      onClose={() => setAttachmentsOpen(false)}
      title={`${t('attachments')} (${activeTestCase?.attachments.length ?? 0})`}
      size="lg"
    >
      <div className="space-y-3">
        {isUploading && (
          <div className="flex items-center gap-2 p-2 bg-slate-800/50 light:bg-slate-50 border border-slate-700 light:border-slate-300 rounded-lg">
            <Loader2 className="w-4 h-4 animate-spin text-cyan-400" />
            <span className="text-xs text-slate-400 light:text-slate-600">{t('uploading')}</span>
          </div>
        )}

        {activeTestCase && activeTestCase.attachments.length > 0 ? (
          <div className="space-y-2">
            {activeTestCase.attachments.map((attachment, i) => {
              const Icon = getFileIcon(attachment);
              return (
                <div
                  key={i}
                  className="flex items-center gap-2 p-2 bg-slate-800 light:bg-slate-50 rounded border border-slate-700 light:border-slate-200 group"
                >
                  <button
                    type="button"
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
                    type="button"
                    onClick={() => void removeAttachment(i)}
                    className="p-1 hover:bg-slate-700 light:hover:bg-slate-200 rounded transition-colors flex-shrink-0"
                    title={t('deleteAttachment')}
                  >
                    <X className="w-3 h-3 text-slate-500 light:text-slate-400 hover:text-rose-400" />
                  </button>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="text-sm text-slate-500 light:text-slate-600">
            {t('noContent')}
          </div>
        )}

        <input
          ref={fileInputRef}
          type="file"
          onChange={handleFileSelect}
          accept={fileUploadCapabilities?.accept ?? getFileInputAccept()}
          multiple
          className="hidden"
        />
        <div className="flex justify-end">
          <Button
            variant="secondary"
            size="sm"
            disabled={isUploading || !activeTestCase}
            onClick={() => fileInputRef.current?.click()}
          >
            <Paperclip className="w-4 h-4" />
            <span>{t('addAttachment')}</span>
          </Button>
        </div>
      </div>
    </Modal>

    <AttachmentModal
      attachment={previewAttachment}
      isOpen={!!previewAttachment}
      onClose={() => setPreviewAttachment(null)}
    />
    </>
  );
}
