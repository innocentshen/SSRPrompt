import { useEffect, useMemo, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useLocation } from 'react-router-dom';
import { Search, FileText, Clock, User, Copy, Loader2 } from 'lucide-react';
import { Button, Badge } from '../components/ui';
import { ParameterPanel, PromptTestPanel, StructuredOutputEditor, VariableEditor } from '../components/Prompt';
import { promptsApi } from '../api';
import { formatDate } from '../lib/date-utils';
import { getErrorMessage } from '../lib/error-messages';
import { toFrontendOutputSchema } from '../lib/output-schema';
import { useToast } from '../store/useUIStore';
import { useGlobalStore } from '../store/useGlobalStore';
import type { PublicPromptDetail, PublicPromptListItem, PromptVersion, PromptVariable } from '../types';
import { DEFAULT_PROMPT_CONFIG, type PromptConfig } from '../types/database';

function formatPromptFromMessages(messages: Array<{ role: string; content: string }>): string {
  return messages.map((m) => `[${m.role.toUpperCase()}]\n${m.content}`).join('\n\n');
}

function safeParseMessageJson(raw: string): Array<{ role: string; content: string }> | null {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return null;
    if (!parsed.every((m) => typeof m === 'object' && m && 'role' in m && 'content' in m)) return null;
    return parsed as Array<{ role: string; content: string }>;
  } catch {
    return null;
  }
}

type PromptRole = 'system' | 'user' | 'assistant';

function normalizeRole(role: string): PromptRole | null {
  const r = role.toLowerCase();
  if (r === 'system' || r === 'user' || r === 'assistant') return r;
  return null;
}

export function PromptPlazaPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { showToast } = useToast();
  const { t } = useTranslation('prompts');
  const { t: tCommon } = useTranslation('common');

  const { providers, models, fetchProvidersAndModels } = useGlobalStore();

  const [items, setItems] = useState<PublicPromptListItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<PublicPromptDetail | null>(null);
  const [versions, setVersions] = useState<PromptVersion[]>([]);
  const [selectedVersion, setSelectedVersion] = useState<number | null>(null);

  const promptIdFromUrl = useMemo(() => {
    const params = new URLSearchParams(location.search);
    const promptId = params.get('promptId');
    return promptId && promptId.trim() ? promptId.trim() : null;
  }, [location.search]);

  useEffect(() => {
    if (!promptIdFromUrl) return;
    setSelectedId(promptIdFromUrl);
  }, [promptIdFromUrl]);

  const [selectedModelId, setSelectedModelId] = useState('');
  const [testInput, setTestInput] = useState('');
  const [variableValues, setVariableValues] = useState<Record<string, string>>({});

  const filteredItems = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return items;
    return items.filter((p) => p.name.toLowerCase().includes(q));
  }, [items, searchQuery]);

  const activeSnapshot = useMemo(() => {
    if (!detail) return null;
    if (!selectedVersion || selectedVersion === detail.publicVersion) return detail;
    const v = versions.find((x) => x.version === selectedVersion);
    if (!v) return detail;

    return {
      ...detail,
      publicVersion: v.version,
      content: v.content,
      variables: v.variables ?? detail.variables,
      messages: v.messages ?? detail.messages,
      config: v.config ?? detail.config,
    } satisfies PublicPromptDetail;
  }, [detail, selectedVersion, versions]);

  const activePromptText = useMemo(() => {
    if (!activeSnapshot) return '';

    if (activeSnapshot.messages.length > 0) {
      return formatPromptFromMessages(activeSnapshot.messages);
    }

    const parsed = safeParseMessageJson(activeSnapshot.content);
    if (parsed) {
      return formatPromptFromMessages(parsed);
    }

    return activeSnapshot.content;
  }, [activeSnapshot]);

  const activePromptMessages = useMemo(() => {
    if (!activeSnapshot) return [] as Array<{ role: PromptRole; content: string }>;

    const raw = activeSnapshot.messages.length > 0
      ? activeSnapshot.messages
      : (safeParseMessageJson(activeSnapshot.content) ?? []);

    return raw
      .map((m) => {
        const role = normalizeRole(m.role);
        if (!role) return null;
        return { role, content: m.content } satisfies { role: PromptRole; content: string };
      })
      .filter((m): m is { role: PromptRole; content: string } => Boolean(m));
  }, [activeSnapshot]);

  const activePromptConfig = useMemo<PromptConfig>(() => {
    const config = (activeSnapshot?.config || {}) as Record<string, unknown>;
    const reasoning = config.reasoning as { enabled?: boolean; effort?: 'default' | 'none' | 'low' | 'medium' | 'high' } | undefined;
    const outputSchema = toFrontendOutputSchema(config.output_schema);

    return {
      temperature: typeof config.temperature === 'number' ? config.temperature : DEFAULT_PROMPT_CONFIG.temperature,
      top_p: typeof config.top_p === 'number' ? config.top_p : DEFAULT_PROMPT_CONFIG.top_p,
      frequency_penalty: typeof config.frequency_penalty === 'number' ? config.frequency_penalty : DEFAULT_PROMPT_CONFIG.frequency_penalty,
      presence_penalty: typeof config.presence_penalty === 'number' ? config.presence_penalty : DEFAULT_PROMPT_CONFIG.presence_penalty,
      max_tokens: typeof config.max_tokens === 'number' ? config.max_tokens : DEFAULT_PROMPT_CONFIG.max_tokens,
      reasoning: reasoning
        ? { enabled: Boolean(reasoning.enabled), effort: reasoning.effort || 'default' }
        : DEFAULT_PROMPT_CONFIG.reasoning,
      output_schema: outputSchema,
    };
  }, [activeSnapshot]);

  // Convert PromptVariable to the format expected by PromptTestPanel
  const activeVariables = useMemo(() => {
    if (!activeSnapshot?.variables) return [];
    return activeSnapshot.variables.map((v: PromptVariable) => ({
      name: v.name,
      type: v.type || 'string',
      description: v.description,
      default_value: v.default_value,
      required: v.required,
    }));
  }, [activeSnapshot]);

  const loadList = useCallback(async () => {
    setLoading(true);
    try {
      const data = await promptsApi.listPublic();
      setItems(data);
    } catch (e) {
      showToast('error', t('loadFailed') + ': ' + getErrorMessage(e));
    } finally {
      setLoading(false);
    }
  }, [showToast, t]);

  const loadDetail = useCallback(async (promptId: string) => {
    try {
      const data = await promptsApi.getPublicById(promptId);
      setDetail(data);
      setSelectedVersion(data.publicVersion);
      setVariableValues({});

      const vs = await promptsApi.getPublicVersions(promptId);
      setVersions(vs);
    } catch (e) {
      showToast('error', t('loadFailed') + ': ' + getErrorMessage(e));
      setDetail(null);
      setVersions([]);
    }
  }, [showToast, t]);

  useEffect(() => {
    fetchProvidersAndModels();
    loadList();
  }, [fetchProvidersAndModels, loadList]);

  useEffect(() => {
    if (!selectedId) return;
    loadDetail(selectedId);
  }, [selectedId, loadDetail]);

  const handleCopy = async () => {
    if (!selectedId) return;
    try {
      await promptsApi.copyPublic(selectedId, selectedVersion ? { version: selectedVersion } : {});
      showToast('success', t('copiedToMy'));
      navigate('/prompts');
    } catch (e) {
      showToast('error', t('copyFailed') + ': ' + getErrorMessage(e));
    }
  };

  return (
    <div className="h-full flex overflow-hidden">
      {/* Left list */}
      <div className="w-80 flex-shrink-0 border-r border-slate-700 light:border-slate-200 bg-slate-950 light:bg-white flex flex-col">
        <div className="p-4 border-b border-slate-700 light:border-slate-200">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={t('searchPublicPlaceholder')}
              className="w-full pl-9 pr-3 py-2 bg-slate-900 light:bg-slate-100 border border-slate-700 light:border-slate-300 rounded-lg text-sm text-slate-200 light:text-slate-800 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-cyan-500/50"
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {loading ? (
            <div className="p-6 text-slate-500 flex items-center justify-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin" />
              {tCommon('loading')}
            </div>
          ) : filteredItems.length === 0 ? (
            <div className="p-6 text-slate-500 text-center">{t('noPublicPrompts')}</div>
          ) : (
            filteredItems.map((p) => {
              const isActive = selectedId === p.id;
              return (
                <button
                  key={p.id}
                  onClick={() => setSelectedId(p.id)}
                  className={`w-full text-left p-3 rounded-lg border transition-colors ${
                    isActive
                      ? 'bg-slate-800 light:bg-cyan-50 border-cyan-500/40'
                      : 'bg-slate-900/40 light:bg-white border-slate-800 light:border-slate-200 hover:bg-slate-800/50 light:hover:bg-slate-50'
                  }`}
                >
                  <div className="flex items-start gap-2">
                    <FileText className="w-4 h-4 mt-0.5 text-slate-500 flex-shrink-0" />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-medium text-slate-200 light:text-slate-800 truncate">{p.name}</p>
                        <Badge variant="info">v{p.publicVersion}</Badge>
                      </div>
                      <div className="mt-1 flex items-center gap-2 text-xs text-slate-500 light:text-slate-600 flex-wrap">
                        <span className="flex items-center gap-1">
                          <User className="w-3 h-3" />
                          {p.author.name || p.author.id}
                        </span>
                        <span className="text-slate-600 light:text-slate-400">|</span>
                        <span className="flex items-center gap-1">
                          <Clock className="w-3 h-3" />
                          {formatDate(p.updatedAt)}
                        </span>
                      </div>
                      {p.defaultModel && (
                        <div className="mt-1 text-xs text-cyan-400 light:text-cyan-700 truncate">
                          {p.defaultModel.name} ({p.defaultModel.providerType})
                        </div>
                      )}
                    </div>
                  </div>
                </button>
              );
            })
          )}
        </div>
      </div>

      {/* Right detail */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {activeSnapshot ? (
          <>
            <div className="h-14 flex-shrink-0 px-6 flex items-center justify-between border-b border-slate-700 light:border-slate-200">
              <div className="flex items-center gap-3 min-w-0">
                <h2 className="text-lg font-medium text-white light:text-slate-900 truncate">{activeSnapshot.name}</h2>
                <Badge variant="info">v{activeSnapshot.publicVersion}</Badge>
                <div className="text-xs text-slate-500 light:text-slate-600 truncate">
                  {t('publishedBy')} {activeSnapshot.author.name || activeSnapshot.author.id}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Button variant="ghost" size="sm" onClick={handleCopy}>
                  <Copy className="w-4 h-4" />
                  <span>{t('copyToMy')}</span>
                </Button>
              </div>
            </div>

            <div className="flex-1 grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_18rem_minmax(0,1fr)] gap-0 overflow-hidden">
              {/* Preview */}
              <div className="min-w-0 border-r border-slate-700 light:border-slate-200 overflow-hidden flex flex-col">
                <div className="p-4 border-b border-slate-700 light:border-slate-200 flex items-center justify-between">
                  <div className="text-sm font-medium text-slate-200 light:text-slate-800">{t('preview')}</div>
                  <div className="flex items-center gap-2">
                    <select
                      value={selectedVersion ?? ''}
                      onChange={(e) => setSelectedVersion(e.target.value ? Number(e.target.value) : null)}
                      className="text-xs bg-slate-800 light:bg-white border border-slate-700 light:border-slate-300 rounded px-2 py-1 text-slate-200 light:text-slate-800"
                    >
                      {versions.map((v) => (
                        <option key={v.id} value={v.version}>
                          v{v.version} {v.commitMessage ? `- ${v.commitMessage}` : ''}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                <div className="flex-1 overflow-y-auto p-4">
                  <pre className="whitespace-pre-wrap text-sm text-slate-200 light:text-slate-800">
                    {activePromptText}
                  </pre>
                </div>
              </div>

              {/* Run Config (read-only) */}
              <div className="border-r border-slate-700 light:border-slate-200 overflow-hidden flex flex-col bg-slate-900/10 light:bg-slate-50">
                <div className="flex-shrink-0 p-4 border-b border-slate-700 light:border-slate-200 flex items-center justify-between">
                  <h3 className="text-sm font-medium text-slate-300 light:text-slate-700">{t('runConfig')}</h3>
                  <Badge variant="default">{tCommon('readOnly')}</Badge>
                </div>
                <div className="flex-1 overflow-y-auto p-4 space-y-3">
                  <div className="p-3 bg-slate-800/50 light:bg-white rounded-lg border border-slate-700 light:border-slate-200">
                    <div className="text-xs text-slate-500 light:text-slate-600 mb-2">{t('runModel')}</div>
                    {activeSnapshot.defaultModel ? (
                      <div className="space-y-1">
                        <div className="text-sm text-slate-200 light:text-slate-800">
                          {activeSnapshot.defaultModel.name} ({activeSnapshot.defaultModel.providerType})
                        </div>
                        <div className="text-xs text-slate-500 light:text-slate-600">{activeSnapshot.defaultModel.modelId}</div>
                      </div>
                    ) : (
                      <div className="text-sm text-slate-500 light:text-slate-600">{t('configureModelFirst')}</div>
                    )}
                  </div>

                  <ParameterPanel
                    config={activePromptConfig}
                    onChange={() => {}}
                    disabled
                    defaultOpen
                    modelId={activeSnapshot.defaultModel?.modelId}
                  />

                  <VariableEditor
                    variables={activeVariables}
                    onChange={() => {}}
                    disabled
                  />

                  <StructuredOutputEditor
                    schema={activePromptConfig.output_schema}
                    onChange={() => {}}
                    disabled
                  />
                </div>
              </div>

              {/* Test Panel - using shared component */}
              <PromptTestPanel
                models={models}
                providers={providers}
                selectedModelId={selectedModelId}
                onModelSelect={setSelectedModelId}
                recommendedModel={activeSnapshot.defaultModel}
                variables={activeVariables}
                variableValues={variableValues}
                onVariableValuesChange={setVariableValues}
                testInput={testInput}
                onTestInputChange={setTestInput}
                promptText={activePromptText}
                promptMessages={activePromptMessages.length > 0 ? activePromptMessages : undefined}
                config={activePromptConfig}
                outputSchema={activePromptConfig.output_schema}
                promptId={activeSnapshot.id}
                saveTrace={false}
                showFileUpload={true}
                className="min-w-0 bg-slate-900/20 light:bg-slate-100"
              />
            </div>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center">
              <FileText className="w-14 h-14 mx-auto mb-3 text-slate-700 light:text-slate-300" />
              <div className="text-slate-500 light:text-slate-600">{t('selectPublicPrompt')}</div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
