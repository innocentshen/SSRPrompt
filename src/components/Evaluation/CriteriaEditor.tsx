import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
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
  const { t } = useTranslation('evaluation');
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
        <div
          onClick={onToggleExpand}
          className="flex items-center gap-3 flex-1 min-w-0 cursor-pointer"
        >
          <div className="p-1 hover:bg-slate-700 light:hover:bg-slate-100 rounded transition-colors">
            {isExpanded ? (
              <ChevronDown className="w-4 h-4 text-slate-400 light:text-slate-500" />
            ) : (
              <ChevronRight className="w-4 h-4 text-slate-400 light:text-slate-500" />
            )}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-slate-200 light:text-slate-800">{criterion.name}</p>
            {criterion.description && (
              <p className="text-xs text-slate-500 light:text-slate-600 truncate">{criterion.description}</p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-500 light:text-slate-600">{t('weight')}</span>
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
            <label className="block text-sm font-medium text-slate-300 light:text-slate-700">{t('criterionName')}</label>
            <input
              type="text"
              value={localName}
              onChange={(e) => setLocalName(e.target.value)}
              onBlur={() => handleBlur('name')}
              className="w-full px-3 py-2 bg-slate-800 light:bg-white border border-slate-700 light:border-slate-300 rounded-lg text-sm text-slate-200 light:text-slate-800 placeholder-slate-500 light:placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-cyan-500/50 focus:border-cyan-500"
            />
          </div>
          <div className="space-y-1.5">
            <label className="block text-sm font-medium text-slate-300 light:text-slate-700">{t('criterionDescription')}</label>
            <input
              type="text"
              value={localDescription}
              onChange={(e) => setLocalDescription(e.target.value)}
              onBlur={() => handleBlur('description')}
              placeholder={t('criterionDescPlaceholder')}
              className="w-full px-3 py-2 bg-slate-800 light:bg-white border border-slate-700 light:border-slate-300 rounded-lg text-sm text-slate-200 light:text-slate-800 placeholder-slate-500 light:placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-cyan-500/50 focus:border-cyan-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-300 light:text-slate-700 mb-2">
              {t('evaluationPrompt')}
            </label>
            <p className="text-xs text-slate-500 light:text-slate-600 mb-2">
              {t('promptVariablesHint')}
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
    nameKey: 'accuracy',
    descKey: 'accuracyDesc',
    promptKey: 'criteriaPromptAccuracy',
  },
  {
    nameKey: 'relevance',
    descKey: 'relevanceDesc',
    promptKey: 'criteriaPromptRelevance',
  },
  {
    nameKey: 'clarity',
    descKey: 'clarityDesc',
    promptKey: 'criteriaPromptClarity',
  },
  {
    nameKey: 'completeness',
    descKey: 'completenessDesc',
    promptKey: 'criteriaPromptCompleteness',
  },
];

export function CriteriaEditor({
  criteria,
  onAdd,
  onUpdate,
  onDelete,
}: CriteriaEditorProps) {
  const { t } = useTranslation('evaluation');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [showTemplates, setShowTemplates] = useState(false);

  const handleAddFromTemplate = (template: typeof DEFAULT_CRITERIA_TEMPLATES[0]) => {
    onAdd({
      name: t(template.nameKey),
      description: t(template.descKey),
      prompt: t(template.promptKey),
      weight: 1.0,
      enabled: true,
    });
    setShowTemplates(false);
  };

  const handleAddCustom = () => {
    onAdd({
      name: t('customCriterionName'),
      description: '',
      prompt: t('criteriaPromptCustom'),
      weight: 1.0,
      enabled: true,
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-slate-300 light:text-slate-700 flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-amber-400 light:text-amber-500" />
          {t('aiCriteria')}
        </h3>
        <div className="flex items-center gap-2">
          <Button variant="secondary" size="sm" onClick={() => setShowTemplates(!showTemplates)}>
            <Plus className="w-4 h-4" />
            <span>{t('addCriterion')}</span>
          </Button>
        </div>
      </div>

      {showTemplates && (
        <div className="p-4 bg-slate-800/50 light:bg-slate-50 border border-slate-700 light:border-slate-200 rounded-lg space-y-2">
          <p className="text-xs text-slate-500 light:text-slate-600 mb-3">{t('selectTemplateOrCustom')}</p>
          <div className="grid grid-cols-2 gap-2">
            {DEFAULT_CRITERIA_TEMPLATES.map((template) => (
              <button
                key={template.nameKey}
                onClick={() => handleAddFromTemplate(template)}
                className="p-3 text-left bg-slate-700/50 light:bg-white hover:bg-slate-700 light:hover:bg-slate-100 border border-slate-600 light:border-slate-200 rounded-lg transition-colors"
              >
                <p className="text-sm font-medium text-slate-200 light:text-slate-800">{t(template.nameKey)}</p>
                <p className="text-xs text-slate-500 light:text-slate-600 mt-1">{t(template.descKey)}</p>
              </button>
            ))}
          </div>
          <button
            onClick={handleAddCustom}
            className="w-full p-3 text-left bg-slate-700/30 light:bg-slate-100 hover:bg-slate-700/50 light:hover:bg-slate-200 border border-dashed border-slate-600 light:border-slate-300 rounded-lg transition-colors mt-2"
          >
            <p className="text-sm font-medium text-slate-400 light:text-slate-600">{t('customCriterion')}</p>
            <p className="text-xs text-slate-500 light:text-slate-500 mt-1">{t('createOwnPrompt')}</p>
          </button>
        </div>
      )}

      {criteria.length === 0 ? (
        <div className="text-center py-8 text-slate-500 light:text-slate-600 text-sm border border-dashed border-slate-700 light:border-slate-300 rounded-lg">
          {t('noCriteriaConfigured')}
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
              <p className="font-medium text-slate-300 light:text-slate-700">{t('weightExplanation')}</p>
              <ul className="space-y-0.5 pl-3">
                <li>{t('weightTip1')}</li>
                <li>{t('weightTip2')}</li>
                <li>{t('weightTip3')}</li>
              </ul>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
