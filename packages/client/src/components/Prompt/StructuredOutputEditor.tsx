import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import {
  FileJson,
  Plus,
  Trash2,
  ChevronDown,
  ChevronRight,
  Code,
  Eye,
  AlertCircle,
  Upload,
  Check,
} from 'lucide-react';
import { Button, Input, Modal } from '../ui';
import { Collapsible } from '../ui/Collapsible';
import type { OutputSchema, SchemaField, SchemaFieldType } from '../../types/database';
import {
  createDefaultField,
  createEmptySchema,
  stringifySchema,
  parseJsonSchemaString,
  inferSchemaFromJson,
} from '../../lib/schema-utils';

const FIELD_TYPES: { value: SchemaFieldType; labelKey: string }[] = [
  { value: 'string', labelKey: 'stringType' },
  { value: 'number', labelKey: 'numberType' },
  { value: 'boolean', labelKey: 'booleanType' },
  { value: 'array', labelKey: 'arrayType' },
  { value: 'object', labelKey: 'objectType' },
];

interface SchemaFieldEditorProps {
  field: SchemaField;
  onChange: (field: SchemaField) => void;
  onDelete: () => void;
  depth?: number;
  t: (key: string) => string;
}

// 获取嵌套层级对应的颜色
function getDepthColor(depth: number): string {
  const colors = [
    'border-cyan-500/50',
    'border-green-500/50',
    'border-amber-500/50',
    'border-purple-500/50',
  ];
  return colors[depth % colors.length];
}

function SchemaFieldEditor({ field, onChange, onDelete, depth = 0, t }: SchemaFieldEditorProps) {
  const [expanded, setExpanded] = useState(false); // 默认折叠
  const hasChildren = field.type === 'object' || field.type === 'array';

  const handleAddProperty = () => {
    if (field.type === 'object') {
      const newProp = createDefaultField((field.properties?.length || 0) + 1);
      onChange({
        ...field,
        properties: [...(field.properties || []), newProp],
      });
    }
  };

  const handleUpdateProperty = (index: number, updatedProp: SchemaField) => {
    if (field.properties) {
      const newProps = [...field.properties];
      newProps[index] = updatedProp;
      onChange({ ...field, properties: newProps });
    }
  };

  const handleDeleteProperty = (index: number) => {
    if (field.properties) {
      onChange({ ...field, properties: field.properties.filter((_, i) => i !== index) });
    }
  };

  const handleSetArrayItems = () => {
    if (field.type === 'array' && !field.items) {
      onChange({
        ...field,
        items: createDefaultField(1),
      });
    }
  };

  // 计算子字段数量提示
  const childCount =
    field.type === 'object'
      ? field.properties?.length || 0
      : field.type === 'array' && field.items
        ? 1
        : 0;

  return (
    <div
      className={`${depth > 0 ? `ml-4 pl-3 border-l-2 ${getDepthColor(depth - 1)}` : ''}`}
    >
      {/* 紧凑头部 - 两行布局 */}
      <div className="border border-slate-700 light:border-slate-200 rounded-lg overflow-hidden">
        <div
          className="px-3 py-2 bg-slate-800/30 light:bg-slate-50 cursor-pointer hover:bg-slate-800/50 light:hover:bg-slate-100 transition-colors"
          onClick={() => setExpanded(!expanded)}
        >
          {/* 第一行：展开按钮、字段名 */}
          <div className="flex items-center gap-2">
            <button
              className="p-0.5 hover:bg-slate-700 light:hover:bg-slate-200 rounded flex-shrink-0"
              onClick={(e) => {
                e.stopPropagation();
                setExpanded(!expanded);
              }}
            >
              {expanded ? (
                <ChevronDown className="w-4 h-4 text-slate-400" />
              ) : (
                <ChevronRight className="w-4 h-4 text-slate-400" />
              )}
            </button>

            <Input
              value={field.name}
              onChange={(e) => onChange({ ...field, name: e.target.value })}
              onClick={(e) => e.stopPropagation()}
              placeholder={t('fieldName')}
              className="flex-1 h-7 text-sm font-mono"
            />
          </div>

          {/* 第二行：类型选择 + 必需 + 删除 + 摘要信息 */}
          <div className="flex items-center gap-2 mt-1.5 ml-6">
            <select
              value={field.type}
              onChange={(e) => {
                e.stopPropagation();
                onChange({
                  ...field,
                  type: e.target.value as SchemaFieldType,
                  items: e.target.value === 'array' ? createDefaultField(1) : undefined,
                  properties: e.target.value === 'object' ? [] : undefined,
                });
              }}
              onClick={(e) => e.stopPropagation()}
              className="w-24 h-7 px-2 text-sm bg-slate-700 light:bg-slate-100 border border-slate-600 light:border-slate-300 rounded text-slate-100 light:text-slate-800 focus:outline-none focus:ring-1 focus:ring-cyan-500 cursor-pointer"
            >
              {FIELD_TYPES.map((ft) => (
                <option key={ft.value} value={ft.value}>
                  {t(ft.labelKey)}
                </option>
              ))}
            </select>

            <label
              className="flex items-center gap-1 text-xs text-slate-300 light:text-slate-600 cursor-pointer flex-shrink-0"
              onClick={(e) => e.stopPropagation()}
            >
              <input
                type="checkbox"
                checked={field.required}
                onChange={(e) => onChange({ ...field, required: e.target.checked })}
                className="w-3.5 h-3.5 rounded border-slate-600 bg-slate-700 text-cyan-500 focus:ring-cyan-500 focus:ring-offset-slate-900"
              />
              {t('required')}
            </label>

            <button
              onClick={(e) => {
                e.stopPropagation();
                onDelete();
              }}
              className="p-1 text-slate-400 hover:text-red-400 light:text-slate-500 light:hover:text-red-500 transition-colors flex-shrink-0"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>

            {/* 摘要信息：描述预览、子字段数量 */}
            {!expanded && (
              <div className="flex items-center gap-2 text-xs text-slate-500 truncate ml-1">
                {field.description && (
                  <span className="truncate max-w-[100px]" title={field.description}>
                    {field.description}
                  </span>
                )}
                {field.type === 'string' && field.enum && field.enum.length > 0 && (
                  <span className="px-1.5 py-0.5 bg-slate-700 light:bg-slate-200 rounded text-slate-400">
                    {field.enum.length} {t('enumValues')}
                  </span>
                )}
                {hasChildren && childCount > 0 && (
                  <span className="px-1.5 py-0.5 bg-slate-700 light:bg-slate-200 rounded text-slate-400">
                    {field.type === 'object' ? `${childCount} ${t('properties')}` : t('defined')}
                  </span>
                )}
              </div>
            )}
          </div>
        </div>

        {/* 展开区域 - 高级选项 */}
        {expanded && (
          <div className="p-3 space-y-3 border-t border-slate-700 light:border-slate-200 bg-slate-900/20 light:bg-white">
            <Input
              value={field.description || ''}
              onChange={(e) => onChange({ ...field, description: e.target.value })}
              placeholder={t('descriptionOptional')}
              className="text-sm"
            />

            {field.type === 'string' && (
              <Input
                value={field.enum?.join(', ') || ''}
                onChange={(e) =>
                  onChange({
                    ...field,
                    enum: e.target.value ? e.target.value.split(',').map((s) => s.trim()) : undefined,
                  })
                }
                placeholder={t('enumValuesOptional')}
                className="text-sm"
              />
            )}

            {field.type === 'array' && (
              <div className="space-y-2">
                <div className="text-xs text-slate-500 font-medium">{t('arrayItemType')}</div>
                {field.items ? (
                  <SchemaFieldEditor
                    field={field.items}
                    onChange={(items) => onChange({ ...field, items })}
                    onDelete={() => onChange({ ...field, items: undefined })}
                    depth={depth + 1}
                    t={t}
                  />
                ) : (
                  <Button variant="secondary" size="sm" onClick={handleSetArrayItems}>
                    <Plus className="w-3 h-3 mr-1" />
                    {t('defineItemType')}
                  </Button>
                )}
              </div>
            )}

            {field.type === 'object' && (
              <div className="space-y-2">
                <div className="text-xs text-slate-500 font-medium">{t('objectProperties')}</div>
                {field.properties?.map((prop, index) => (
                  <SchemaFieldEditor
                    key={index}
                    field={prop}
                    onChange={(p) => handleUpdateProperty(index, p)}
                    onDelete={() => handleDeleteProperty(index)}
                    depth={depth + 1}
                    t={t}
                  />
                ))}
                <Button variant="secondary" size="sm" onClick={handleAddProperty} className="text-xs">
                  <Plus className="w-3 h-3 mr-1" />
                  {t('addProperty')}
                </Button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

interface StructuredOutputEditorProps {
  schema: OutputSchema | undefined;
  onChange: (schema: OutputSchema | undefined) => void;
  disabled?: boolean;
}

export function StructuredOutputEditor({
  schema,
  onChange,
  disabled,
}: StructuredOutputEditorProps) {
  const { t } = useTranslation('prompts');
  const { t: tCommon } = useTranslation('common');
  const [mode, setMode] = useState<'visual' | 'json'>('visual');
  const [jsonText, setJsonText] = useState('');
  const [jsonError, setJsonError] = useState<string | null>(null);
  const [showImportModal, setShowImportModal] = useState(false);
  const [importText, setImportText] = useState('');
  const [importError, setImportError] = useState<string | null>(null);

  useEffect(() => {
    if (schema && mode === 'json') {
      setJsonText(stringifySchema(schema));
      setJsonError(null);
    }
  }, [schema, mode]);

  const handleToggleEnabled = () => {
    if (schema?.enabled) {
      onChange({ ...schema, enabled: false });
    } else {
      onChange(schema ? { ...schema, enabled: true } : { ...createEmptySchema(), enabled: true });
    }
  };

  const handleAddField = () => {
    if (!schema) return;
    const newField = createDefaultField(schema.fields.length + 1);
    onChange({ ...schema, fields: [...schema.fields, newField] });
  };

  const handleUpdateField = (index: number, field: SchemaField) => {
    if (!schema) return;
    const newFields = [...schema.fields];
    newFields[index] = field;
    onChange({ ...schema, fields: newFields });
  };

  const handleDeleteField = (index: number) => {
    if (!schema) return;
    onChange({ ...schema, fields: schema.fields.filter((_, i) => i !== index) });
  };

  const handleJsonChange = (text: string) => {
    setJsonText(text);
    setJsonError(null);

    if (!text.trim()) {
      return;
    }

    const parsed = parseJsonSchemaString(text);
    if (parsed) {
      onChange({ ...parsed, enabled: schema?.enabled ?? true, name: schema?.name ?? 'response' });
    } else {
      setJsonError(t('invalidJsonSchema'));
    }
  };

  const handleImportJson = () => {
    setImportError(null);

    if (!importText.trim()) {
      setImportError(t('enterJsonExample'));
      return;
    }

    const inferred = inferSchemaFromJson(importText);
    if (inferred) {
      onChange({ ...inferred, enabled: true });
      setShowImportModal(false);
      setImportText('');
    } else {
      setImportError(t('cannotParseJson'));
    }
  };

  const isEnabled = schema?.enabled ?? false;

  return (
    <>
      <Collapsible
        title={t('structuredOutput')}
        icon={<FileJson className="w-4 h-4 text-green-400" />}
        defaultOpen={false}
        action={
          <button
            onClick={(e) => {
              e.stopPropagation();
              handleToggleEnabled();
            }}
            disabled={disabled}
            className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
              isEnabled ? 'bg-cyan-500' : 'bg-slate-600'
            } ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
          >
            <span
              className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${
                isEnabled ? 'translate-x-5' : 'translate-x-1'
              }`}
            />
          </button>
        }
      >
        {isEnabled && schema && (
          <div className="space-y-3">
            {/* Mode switcher */}
            <div className="flex items-center gap-2">
              <button
                onClick={() => setMode('visual')}
                disabled={disabled}
                className={`flex items-center gap-1 px-2 py-1 text-xs rounded transition-colors ${
                  mode === 'visual'
                    ? 'bg-cyan-500 text-white'
                    : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
                } ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
              >
                <Eye className="w-3 h-3" />
                {t('visual')}
              </button>
              <button
                onClick={() => setMode('json')}
                disabled={disabled}
                className={`flex items-center gap-1 px-2 py-1 text-xs rounded transition-colors ${
                  mode === 'json'
                    ? 'bg-cyan-500 text-white'
                    : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
                } ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
              >
                <Code className="w-3 h-3" />
                {t('json')}
              </button>
              <div className="flex-1" />
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowImportModal(true)}
                disabled={disabled}
                className="text-xs"
              >
                <Upload className="w-3 h-3 mr-1" />
                {t('import')}
              </Button>
            </div>

            {/* Schema name */}
            <div className="flex items-center gap-2">
              <Input
                value={schema.name}
                onChange={(e) => onChange({ ...schema, name: e.target.value })}
                placeholder="response"
                disabled={disabled}
                className="flex-1 text-sm"
              />
              <label className="flex items-center gap-1.5 text-xs text-slate-400 cursor-pointer whitespace-nowrap">
                <input
                  type="checkbox"
                  checked={schema.strict}
                  onChange={(e) => onChange({ ...schema, strict: e.target.checked })}
                  disabled={disabled}
                  className="w-3.5 h-3.5 rounded border-slate-600 bg-slate-700 text-cyan-500 focus:ring-cyan-500"
                />
                {t('strict')}
              </label>
            </div>

            {/* Visual Editor */}
            {mode === 'visual' && (
              <div className="space-y-2">
                {schema.fields.length === 0 ? (
                  <div className="text-center py-3 border border-dashed border-slate-700 rounded-lg">
                    <p className="text-xs text-slate-500 mb-2">{t('noOutputStructure')}</p>
                    <div className="flex items-center justify-center gap-2">
                      <Button variant="ghost" size="sm" onClick={handleAddField} disabled={disabled} className="text-xs">
                        <Plus className="w-3 h-3 mr-1" />
                        {t('addField')}
                      </Button>
                    </div>
                  </div>
                ) : (
                  <>
                    {schema.fields.map((field, index) => (
                      <SchemaFieldEditor
                        key={index}
                        field={field}
                        onChange={(f) => handleUpdateField(index, f)}
                        onDelete={() => handleDeleteField(index)}
                        t={t}
                      />
                    ))}
                    <Button variant="ghost" size="sm" onClick={handleAddField} disabled={disabled} className="w-full text-xs">
                      <Plus className="w-3 h-3 mr-1" />
                      {t('addField')}
                    </Button>
                  </>
                )}
              </div>
            )}

            {/* JSON Editor */}
            {mode === 'json' && (
              <div className="space-y-2">
                <textarea
                  value={jsonText}
                  onChange={(e) => handleJsonChange(e.target.value)}
                  disabled={disabled}
                  placeholder={t('enterJsonSchema')}
                  className={`w-full h-32 px-2 py-1.5 bg-slate-800 light:bg-slate-100 border rounded text-xs font-mono text-slate-200 light:text-slate-800 placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-cyan-500 resize-none ${
                    jsonError
                      ? 'border-red-500'
                      : 'border-slate-700 light:border-slate-200'
                  } ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
                />
                {jsonError && (
                  <div className="flex items-center gap-1 text-xs text-red-400">
                    <AlertCircle className="w-3 h-3" />
                    {jsonError}
                  </div>
                )}
              </div>
            )}

            <p className="text-xs text-slate-500">
              {t('enabledAiReturnsJson')}
            </p>
          </div>
        )}
      </Collapsible>

      {/* Import JSON Modal */}
      <Modal
        isOpen={showImportModal}
        onClose={() => {
          setShowImportModal(false);
          setImportText('');
          setImportError(null);
        }}
        title={t('importFromJson')}
      >
        <div className="space-y-4">
          <p className="text-sm text-slate-400 light:text-slate-600">
            {t('pasteJsonExample')}
          </p>

          <textarea
            value={importText}
            onChange={(e) => {
              setImportText(e.target.value);
              setImportError(null);
            }}
            placeholder={`Example:
{
  "name": "John",
  "age": 25,
  "skills": ["React", "TypeScript"],
  "address": {
    "city": "Beijing",
    "district": "Chaoyang"
  }
}`}
            className={`w-full h-64 px-3 py-2 bg-slate-800 light:bg-slate-100 border rounded-lg text-sm font-mono text-slate-200 light:text-slate-800 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-cyan-500 resize-none ${
              importError ? 'border-red-500' : 'border-slate-700 light:border-slate-200'
            }`}
          />

          {importError && (
            <div className="flex items-center gap-2 text-sm text-red-400">
              <AlertCircle className="w-4 h-4" />
              {importError}
            </div>
          )}

          <div className="flex justify-end gap-3">
            <Button
              variant="secondary"
              onClick={() => {
                setShowImportModal(false);
                setImportText('');
                setImportError(null);
              }}
            >
              {tCommon('cancel')}
            </Button>
            <Button variant="primary" onClick={handleImportJson}>
              <Check className="w-4 h-4 mr-1" />
              {t('importAndGenerate')}
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}
