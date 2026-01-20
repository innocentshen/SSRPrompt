import { useMemo, useState } from 'react';
import { Plus, Search } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '../ui';
import { TestCaseEditor } from './TestCaseEditor';
import type { TestCase, ProviderType } from '../../types';

interface FileUploadCapabilities {
  accept: string;
  canUploadImage: boolean;
  canUploadPdf: boolean;
  canUploadText: boolean;
}

interface TestCaseListProps {
  testCases: TestCase[];
  variables: string[];
  onAdd: () => void;
  onUpdate: (testCase: TestCase) => Promise<void>;
  onDelete: (id: string) => void;
  onRunSingle?: (testCase: TestCase) => void;
  runningTestCaseId?: string | null;
  selectedTestCaseIds?: Set<string>;
  onToggleSelect?: (id: string, selected: boolean) => void;
  fileUploadCapabilities?: FileUploadCapabilities;
  providerType?: ProviderType;
  modelId?: string;
  supportsVision?: boolean;
}

export function TestCaseList({
  testCases,
  variables,
  onAdd,
  onUpdate,
  onDelete,
  onRunSingle,
  runningTestCaseId,
  selectedTestCaseIds,
  onToggleSelect,
  fileUploadCapabilities,
  providerType,
  modelId,
  supportsVision,
}: TestCaseListProps) {
  const { t } = useTranslation('evaluation');
  const selectedCount = selectedTestCaseIds?.size || 0;
  const [query, setQuery] = useState('');
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

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <h3 className="text-sm font-medium text-slate-300 light:text-slate-700">
          {t('testCases')} ({selectedCount > 0 ? `${selectedCount}/${testCases.length}` : testCases.length})
        </h3>
        <div className="relative flex-1 max-w-[240px]">
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
        <Button variant="secondary" size="sm" onClick={onAdd} className="shrink-0">
          <Plus className="w-4 h-4" />
          <span>{t('addTestCase')}</span>
        </Button>
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
        <div className="space-y-3">
          {filteredTestCases.map((testCase, index) => (
            <TestCaseEditor
              key={testCase.id}
              testCase={testCase}
              index={index}
              variables={variables}
              onUpdate={onUpdate}
              onDelete={() => onDelete(testCase.id)}
              onRunSingle={onRunSingle ? () => onRunSingle(testCase) : undefined}
              isRunning={runningTestCaseId === testCase.id}
              isSelected={selectedTestCaseIds ? selectedTestCaseIds.has(testCase.id) : false}
              onSelectChange={onToggleSelect ? (selected) => onToggleSelect(testCase.id, selected) : undefined}
              fileUploadCapabilities={fileUploadCapabilities}
              providerType={providerType}
              modelId={modelId}
              supportsVision={supportsVision}
            />
          ))}
        </div>
      )}
    </div>
  );
}
