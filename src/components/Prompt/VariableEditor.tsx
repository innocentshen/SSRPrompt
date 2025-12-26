import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Variable, Plus, Trash2, ChevronDown, ChevronRight } from 'lucide-react';
import { PromptVariable, PromptVariableType } from '../../types/database';
import { Button, Input, Select, Collapsible } from '../ui';

interface VariableEditorProps {
  variables: PromptVariable[];
  onChange: (variables: PromptVariable[]) => void;
  disabled?: boolean;
  defaultOpen?: boolean;
}

const VARIABLE_TYPES_KEYS: { value: PromptVariableType; labelKey: string }[] = [
  { value: 'string', labelKey: 'stringType' },
  { value: 'number', labelKey: 'numberType' },
  { value: 'boolean', labelKey: 'booleanType' },
  { value: 'array', labelKey: 'arrayType' },
  { value: 'object', labelKey: 'objectType' },
];

export function VariableEditor({ variables, onChange, disabled = false, defaultOpen = false }: VariableEditorProps) {
  const { t } = useTranslation('prompts');
  const { t: tCommon } = useTranslation('common');
  const [expandedIndex, setExpandedIndex] = useState<number | null>(null);

  const variableTypes = VARIABLE_TYPES_KEYS.map(vt => ({
    value: vt.value,
    label: t(vt.labelKey)
  }));

  const getTypeLabel = (type: PromptVariableType) => {
    const found = VARIABLE_TYPES_KEYS.find(vt => vt.value === type);
    return found ? t(found.labelKey) : type;
  };

  const handleAddVariable = () => {
    const newVariable: PromptVariable = {
      name: `var_${variables.length + 1}`,
      type: 'string',
      description: '',
      default_value: '',
      required: true,
    };
    onChange([...variables, newVariable]);
    setExpandedIndex(variables.length);
  };

  const handleUpdateVariable = (index: number, updates: Partial<PromptVariable>) => {
    const newVariables = [...variables];
    newVariables[index] = { ...newVariables[index], ...updates };
    onChange(newVariables);
  };

  const handleDeleteVariable = (index: number) => {
    const newVariables = variables.filter((_, i) => i !== index);
    onChange(newVariables);
    if (expandedIndex === index) {
      setExpandedIndex(null);
    }
  };

  return (
    <Collapsible
      title={`${t('variableDefinition')} (${variables.length})`}
      icon={<Variable className="w-4 h-4 text-amber-400 light:text-amber-600" />}
      defaultOpen={defaultOpen}
      action={
        <Button
          variant="ghost"
          size="sm"
          onClick={(e) => {
            e.stopPropagation();
            handleAddVariable();
          }}
          disabled={disabled}
          className="text-xs"
        >
          <Plus className="w-3 h-3 mr-1" />
          {tCommon('add')}
        </Button>
      }
    >
      <div className="space-y-2">
        {variables.length === 0 ? (
          <div className="text-center py-4 text-slate-500 light:text-slate-500 text-sm">
            <p>{t('useVariableSyntax')}</p>
          </div>
        ) : (
          variables.map((variable, index) => (
            <div
              key={index}
              className="border border-slate-700 light:border-slate-200 rounded-lg overflow-hidden"
            >
              {/* Variable header */}
              <div
                className="flex items-center gap-2 px-3 py-2 bg-slate-800/50 light:bg-slate-50 cursor-pointer hover:bg-slate-800 light:hover:bg-slate-100 transition-colors"
                onClick={() => setExpandedIndex(expandedIndex === index ? null : index)}
              >
                {expandedIndex === index ? (
                  <ChevronDown className="w-4 h-4 text-slate-400" />
                ) : (
                  <ChevronRight className="w-4 h-4 text-slate-400" />
                )}
                <code className="text-sm text-amber-400 light:text-amber-600 font-mono">
                  {variable.name}
                </code>
                <span className="text-xs text-slate-500 px-1.5 py-0.5 bg-slate-700 light:bg-slate-200 rounded">
                  {getTypeLabel(variable.type)}
                </span>
                {variable.required && (
                  <span className="text-xs text-red-400 light:text-red-500">*</span>
                )}
                <div className="flex-1" />
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDeleteVariable(index);
                  }}
                  disabled={disabled}
                  className="p-1 text-slate-500 hover:text-red-400 light:hover:text-red-500 transition-colors"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>

              {/* Variable details */}
              {expandedIndex === index && (
                <div className="p-3 space-y-3 bg-slate-900/30 light:bg-white border-t border-slate-700 light:border-slate-200">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs text-slate-400 light:text-slate-600 mb-1">
                        {t('variableName')}
                      </label>
                      <Input
                        value={variable.name}
                        onChange={(e) => handleUpdateVariable(index, { name: e.target.value })}
                        placeholder="variable_name"
                        disabled={disabled}
                        className="font-mono"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-slate-400 light:text-slate-600 mb-1">
                        {t('variableType')}
                      </label>
                      <Select
                        value={variable.type}
                        onChange={(e) =>
                          handleUpdateVariable(index, { type: e.target.value as PromptVariableType })
                        }
                        options={variableTypes}
                        disabled={disabled}
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs text-slate-400 light:text-slate-600 mb-1">
                      {t('variableDesc')}
                    </label>
                    <Input
                      value={variable.description || ''}
                      onChange={(e) => handleUpdateVariable(index, { description: e.target.value })}
                      placeholder={t('variableDescPlaceholder')}
                      disabled={disabled}
                    />
                  </div>

                  <div>
                    <label className="block text-xs text-slate-400 light:text-slate-600 mb-1">
                      {t('defaultValue')}
                    </label>
                    <Input
                      value={variable.default_value || ''}
                      onChange={(e) => handleUpdateVariable(index, { default_value: e.target.value })}
                      placeholder={t('defaultValuePlaceholder')}
                      disabled={disabled}
                    />
                  </div>

                  <div className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      id={`required-${index}`}
                      checked={variable.required ?? true}
                      onChange={(e) => handleUpdateVariable(index, { required: e.target.checked })}
                      disabled={disabled}
                      className="w-4 h-4 rounded border-slate-600 light:border-slate-300 bg-slate-800 light:bg-white text-cyan-500 focus:ring-cyan-500"
                    />
                    <label
                      htmlFor={`required-${index}`}
                      className="text-sm text-slate-300 light:text-slate-700"
                    >
                      {t('requiredField')}
                    </label>
                  </div>
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </Collapsible>
  );
}
