import { useState, useEffect } from 'react';
import { Plus, Trash2, ChevronDown, ChevronRight, Sparkles } from 'lucide-react';
import { Button, Toggle } from '../ui';
import type { EvaluationCriterion } from '../../types';

interface CriteriaEditorProps {
  criteria: EvaluationCriterion[];
  onAdd: (criterion: Omit<EvaluationCriterion, 'id' | 'evaluation_id' | 'created_at'>) => void;
  onUpdate: (criterion: EvaluationCriterion) => void;
  onDelete: (id: string) => void;
}

interface EditableCriterionProps {
  criterion: EvaluationCriterion;
  isExpanded: boolean;
  onToggleExpand: () => void;
  onUpdate: (criterion: EvaluationCriterion) => void;
  onDelete: () => void;
}

function EditableCriterion({
  criterion,
  isExpanded,
  onToggleExpand,
  onUpdate,
  onDelete,
}: EditableCriterionProps) {
  const [localName, setLocalName] = useState(criterion.name);
  const [localDescription, setLocalDescription] = useState(criterion.description);
  const [localPrompt, setLocalPrompt] = useState(criterion.prompt);
  const [localWeight, setLocalWeight] = useState(String(criterion.weight));

  useEffect(() => {
    setLocalName(criterion.name);
    setLocalDescription(criterion.description);
    setLocalPrompt(criterion.prompt);
    setLocalWeight(String(criterion.weight));
  }, [criterion.id]);

  const handleBlur = (field: 'name' | 'description' | 'prompt' | 'weight') => {
    let hasChanged = false;
    const updated = { ...criterion };

    switch (field) {
      case 'name':
        if (localName !== criterion.name) {
          updated.name = localName;
          hasChanged = true;
        }
        break;
      case 'description':
        if (localDescription !== criterion.description) {
          updated.description = localDescription;
          hasChanged = true;
        }
        break;
      case 'prompt':
        if (localPrompt !== criterion.prompt) {
          updated.prompt = localPrompt;
          hasChanged = true;
        }
        break;
      case 'weight':
        const weightNum = parseFloat(localWeight) || 0;
        if (weightNum !== criterion.weight) {
          updated.weight = weightNum;
          hasChanged = true;
        }
        break;
    }

    if (hasChanged) {
      onUpdate(updated);
    }
  };

  return (
    <div className="border border-slate-700 light:border-slate-200 rounded-lg bg-slate-800/30 light:bg-white overflow-hidden light:shadow-sm">
      <div className="flex items-center gap-3 p-3">
        <button
          onClick={onToggleExpand}
          className="p-1 hover:bg-slate-700 light:hover:bg-slate-100 rounded transition-colors"
        >
          {isExpanded ? (
            <ChevronDown className="w-4 h-4 text-slate-400 light:text-slate-500" />
          ) : (
            <ChevronRight className="w-4 h-4 text-slate-400 light:text-slate-500" />
          )}
        </button>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-slate-200 light:text-slate-800">{criterion.name}</p>
          {criterion.description && (
            <p className="text-xs text-slate-500 light:text-slate-600 truncate">{criterion.description}</p>
          )}
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-500 light:text-slate-600">权重</span>
            <input
              type="number"
              min="0"
              step="0.1"
              value={localWeight}
              onChange={(e) => setLocalWeight(e.target.value)}
              onBlur={() => handleBlur('weight')}
              className="w-16 px-2 py-1 bg-slate-800 light:bg-white border border-slate-600 light:border-slate-300 rounded text-xs text-slate-200 light:text-slate-800 focus:outline-none focus:ring-1 focus:ring-cyan-500/50"
            />
          </div>
          <Toggle
            checked={criterion.enabled}
            onChange={(checked) => onUpdate({ ...criterion, enabled: checked })}
            size="sm"
          />
          <Button variant="ghost" size="sm" onClick={onDelete}>
            <Trash2 className="w-4 h-4 text-slate-500 light:text-slate-400 hover:text-rose-400" />
          </Button>
        </div>
      </div>

      {isExpanded && (
        <div className="p-4 pt-0 space-y-3 border-t border-slate-700/50 light:border-slate-200">
          <div className="space-y-1.5">
            <label className="block text-sm font-medium text-slate-300 light:text-slate-700">标准名称</label>
            <input
              type="text"
              value={localName}
              onChange={(e) => setLocalName(e.target.value)}
              onBlur={() => handleBlur('name')}
              className="w-full px-3 py-2 bg-slate-800 light:bg-white border border-slate-700 light:border-slate-300 rounded-lg text-sm text-slate-200 light:text-slate-800 placeholder-slate-500 light:placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-cyan-500/50 focus:border-cyan-500"
            />
          </div>
          <div className="space-y-1.5">
            <label className="block text-sm font-medium text-slate-300 light:text-slate-700">描述</label>
            <input
              type="text"
              value={localDescription}
              onChange={(e) => setLocalDescription(e.target.value)}
              onBlur={() => handleBlur('description')}
              placeholder="简要描述这个评价标准"
              className="w-full px-3 py-2 bg-slate-800 light:bg-white border border-slate-700 light:border-slate-300 rounded-lg text-sm text-slate-200 light:text-slate-800 placeholder-slate-500 light:placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-cyan-500/50 focus:border-cyan-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-300 light:text-slate-700 mb-2">
              评价提示词
            </label>
            <p className="text-xs text-slate-500 light:text-slate-600 mb-2">
              可用变量: {'{{input}}'} (输入), {'{{output}}'} (输出), {'{{expected}}'} (期望输出)
            </p>
            <textarea
              value={localPrompt}
              onChange={(e) => setLocalPrompt(e.target.value)}
              onBlur={() => handleBlur('prompt')}
              rows={8}
              className="w-full px-3 py-2 bg-slate-800 light:bg-white border border-slate-600 light:border-slate-300 rounded-lg text-slate-200 light:text-slate-800 placeholder-slate-500 light:placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-cyan-500/50 focus:border-cyan-500 resize-none text-sm font-mono"
            />
          </div>
        </div>
      )}
    </div>
  );
}

const DEFAULT_CRITERIA_TEMPLATES = [
  {
    name: '准确性',
    description: '评估输出内容的准确性和正确性',
    prompt: `请评估以下AI输出的准确性。

输入: {{input}}
{{#expected}}期望输出: {{expected}}{{/expected}}
实际输出: {{output}}

请从以下角度评估：
1. 信息是否准确无误
2. 是否存在事实性错误
3. 逻辑是否正确

请给出1-10分的评分，并简要说明理由。
格式: {"score": 数字, "reason": "理由"}`,
  },
  {
    name: '相关性',
    description: '评估输出是否切题和相关',
    prompt: `请评估以下AI输出的相关性。

输入: {{input}}
实际输出: {{output}}

请从以下角度评估：
1. 输出是否回答了问题
2. 内容是否与主题相关
3. 是否存在离题内容

请给出1-10分的评分，并简要说明理由。
格式: {"score": 数字, "reason": "理由"}`,
  },
  {
    name: '清晰度',
    description: '评估输出的清晰度和可读性',
    prompt: `请评估以下AI输出的清晰度。

实际输出: {{output}}

请从以下角度评估：
1. 表达是否清晰易懂
2. 结构是否合理
3. 语言是否流畅

请给出1-10分的评分，并简要说明理由。
格式: {"score": 数字, "reason": "理由"}`,
  },
  {
    name: '完整性',
    description: '评估输出的完整性',
    prompt: `请评估以下AI输出的完整性。

输入: {{input}}
{{#expected}}期望输出: {{expected}}{{/expected}}
实际输出: {{output}}

请从以下角度评估：
1. 回答是否完整
2. 是否遗漏重要信息
3. 深度是否足够

请给出1-10分的评分，并简要说明理由。
格式: {"score": 数字, "reason": "理由"}`,
  },
];

export function CriteriaEditor({
  criteria,
  onAdd,
  onUpdate,
  onDelete,
}: CriteriaEditorProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [showTemplates, setShowTemplates] = useState(false);

  const handleAddFromTemplate = (template: typeof DEFAULT_CRITERIA_TEMPLATES[0]) => {
    onAdd({
      name: template.name,
      description: template.description,
      prompt: template.prompt,
      weight: 1.0,
      enabled: true,
    });
    setShowTemplates(false);
  };

  const handleAddCustom = () => {
    onAdd({
      name: '自定义标准',
      description: '',
      prompt: `请评估以下AI输出。

输入: {{input}}
{{#expected}}期望输出: {{expected}}{{/expected}}
实际输出: {{output}}

请给出1-10分的评分，并简要说明理由。
格式: {"score": 数字, "reason": "理由"}`,
      weight: 1.0,
      enabled: true,
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-slate-300 light:text-slate-700 flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-amber-400 light:text-amber-500" />
          AI 评价标准
        </h3>
        <div className="flex items-center gap-2">
          <Button variant="secondary" size="sm" onClick={() => setShowTemplates(!showTemplates)}>
            <Plus className="w-4 h-4" />
            <span>添加标准</span>
          </Button>
        </div>
      </div>

      {showTemplates && (
        <div className="p-4 bg-slate-800/50 light:bg-slate-50 border border-slate-700 light:border-slate-200 rounded-lg space-y-2">
          <p className="text-xs text-slate-500 light:text-slate-600 mb-3">选择预设模板或创建自定义标准</p>
          <div className="grid grid-cols-2 gap-2">
            {DEFAULT_CRITERIA_TEMPLATES.map((template) => (
              <button
                key={template.name}
                onClick={() => handleAddFromTemplate(template)}
                className="p-3 text-left bg-slate-700/50 light:bg-white hover:bg-slate-700 light:hover:bg-slate-100 border border-slate-600 light:border-slate-200 rounded-lg transition-colors"
              >
                <p className="text-sm font-medium text-slate-200 light:text-slate-800">{template.name}</p>
                <p className="text-xs text-slate-500 light:text-slate-600 mt-1">{template.description}</p>
              </button>
            ))}
          </div>
          <button
            onClick={handleAddCustom}
            className="w-full p-3 text-left bg-slate-700/30 light:bg-slate-100 hover:bg-slate-700/50 light:hover:bg-slate-200 border border-dashed border-slate-600 light:border-slate-300 rounded-lg transition-colors mt-2"
          >
            <p className="text-sm font-medium text-slate-400 light:text-slate-600">+ 自定义标准</p>
            <p className="text-xs text-slate-500 light:text-slate-500 mt-1">创建自己的评价提示词</p>
          </button>
        </div>
      )}

      {criteria.length === 0 ? (
        <div className="text-center py-8 text-slate-500 light:text-slate-600 text-sm border border-dashed border-slate-700 light:border-slate-300 rounded-lg">
          暂未配置评价标准，点击上方按钮添加
        </div>
      ) : (
        <div className="space-y-2">
          {criteria.map((criterion) => (
            <EditableCriterion
              key={criterion.id}
              criterion={criterion}
              isExpanded={expandedId === criterion.id}
              onToggleExpand={() => setExpandedId(expandedId === criterion.id ? null : criterion.id)}
              onUpdate={onUpdate}
              onDelete={() => onDelete(criterion.id)}
            />
          ))}
        </div>
      )}

      {criteria.length > 0 && (
        <div className="p-3 bg-slate-800/30 light:bg-cyan-50 border border-slate-700 light:border-cyan-200 rounded-lg">
          <div className="flex items-start gap-2">
            <div className="flex-shrink-0 mt-0.5">
              <Sparkles className="w-4 h-4 text-cyan-400 light:text-cyan-600" />
            </div>
            <div className="text-xs text-slate-400 light:text-slate-600 space-y-1">
              <p className="font-medium text-slate-300 light:text-slate-700">权重说明：</p>
              <ul className="space-y-0.5 pl-3">
                <li>权重用于计算加权平均分，权重越高影响越大</li>
                <li>建议将重要标准设置为 1.5-2.0，次要标准设置为 0.5-1.0</li>
                <li>可以通过右侧开关临时禁用某个标准，被禁用的标准不参与评测</li>
              </ul>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
