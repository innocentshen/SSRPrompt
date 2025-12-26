import { Plus } from 'lucide-react';
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
  fileUploadCapabilities,
  providerType,
  modelId,
  supportsVision,
}: TestCaseListProps) {
  const { t } = useTranslation('evaluation');

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-slate-300 light:text-slate-700">
          {t('testCases')} ({testCases.length})
        </h3>
        <Button variant="secondary" size="sm" onClick={onAdd}>
          <Plus className="w-4 h-4" />
          <span>{t('addTestCase')}</span>
        </Button>
      </div>

      {testCases.length === 0 ? (
        <div className="text-center py-8 text-slate-500 light:text-slate-600 text-sm border border-dashed border-slate-700 light:border-slate-300 rounded-lg">
          <p>{t('noTestCases')}</p>
          <p className="text-xs mt-1">{t('clickAddFirstTest')}</p>
        </div>
      ) : (
        <div className="space-y-3">
          {testCases.map((testCase, index) => (
            <TestCaseEditor
              key={testCase.id}
              testCase={testCase}
              index={index}
              variables={variables}
              onUpdate={onUpdate}
              onDelete={() => onDelete(testCase.id)}
              onRunSingle={onRunSingle ? () => onRunSingle(testCase) : undefined}
              isRunning={runningTestCaseId === testCase.id}
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
