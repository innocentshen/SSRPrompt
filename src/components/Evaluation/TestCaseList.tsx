import { Plus } from 'lucide-react';
import { Button } from '../ui';
import { TestCaseEditor } from './TestCaseEditor';
import type { TestCase } from '../../types';

interface TestCaseListProps {
  testCases: TestCase[];
  variables: string[];
  onAdd: () => void;
  onUpdate: (testCase: TestCase) => Promise<void>;
  onDelete: (id: string) => void;
}

export function TestCaseList({
  testCases,
  variables,
  onAdd,
  onUpdate,
  onDelete,
}: TestCaseListProps) {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-slate-300 light:text-slate-700">
          测试用例 ({testCases.length})
        </h3>
        <Button variant="secondary" size="sm" onClick={onAdd}>
          <Plus className="w-4 h-4" />
          <span>添加用例</span>
        </Button>
      </div>

      {testCases.length === 0 ? (
        <div className="text-center py-8 text-slate-500 light:text-slate-600 text-sm border border-dashed border-slate-700 light:border-slate-300 rounded-lg">
          <p>暂无测试用例</p>
          <p className="text-xs mt-1">点击"添加用例"创建第一个测试</p>
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
            />
          ))}
        </div>
      )}
    </div>
  );
}
