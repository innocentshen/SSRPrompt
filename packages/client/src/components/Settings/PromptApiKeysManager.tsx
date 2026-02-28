import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Ban, BookOpenText, Check, ChevronDown, ChevronUp, Copy, KeyRound, Loader2 } from 'lucide-react';
import { promptApiKeysApi, promptGroupsApi, promptsApi } from '../../api';
import { getErrorMessage } from '../../lib/error-messages';
import { formatDateTime } from '../../lib/date-utils';
import { invalidatePromptsCache } from '../../lib/cache-events';
import type { PromptApiVersionMode } from '@ssrprompt/shared';
import type { PromptApiKey, PromptGroup, PromptListItem } from '../../types';
import { Button, Input, Toggle, useToast } from '../ui';

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001/api/v1';

type SpecTab = 'overview' | 'request' | 'response' | 'examples' | 'multiturn';
type SpecRow = { name: string; type: string; required: string; description: string };

type RowDef = {
  name: string;
  type: string;
  required: 'yes' | 'no';
  descKey: string;
  defaultDesc: string;
};

const REQUEST_HEADER_DEFS: RowDef[] = [
  {
    name: 'Authorization',
    type: 'Bearer <prompt_api_key>',
    required: 'no',
    descKey: 'promptApiHeaderAuthorizationDesc',
    defaultDesc: 'Optional. Use this or X-API-Key.',
  },
  {
    name: 'X-API-Key',
    type: '<prompt_api_key>',
    required: 'no',
    descKey: 'promptApiHeaderXApiKeyDesc',
    defaultDesc: 'Optional. Use this or Authorization.',
  },
  {
    name: 'Content-Type',
    type: 'application/json',
    required: 'yes',
    descKey: 'promptApiHeaderContentTypeDesc',
    defaultDesc: 'Required request content type.',
  },
];

const REQUEST_BODY_DEFS: RowDef[] = [
  {
    name: 'input',
    type: 'string',
    required: 'no',
    descKey: 'promptApiReqInputDesc',
    defaultDesc: 'Current user input.',
  },
  {
    name: 'conversationId',
    type: 'string (1-128)',
    required: 'no',
    descKey: 'promptApiReqConversationIdDesc',
    defaultDesc: 'Optional on first turn. You can provide your own id and reuse it across turns.',
  },
  {
    name: 'historyLimit',
    type: 'number (0-50)',
    required: 'no',
    descKey: 'promptApiReqHistoryLimitDesc',
    defaultDesc: 'How many previous turns are loaded. Default 12.',
  },
  {
    name: 'variables',
    type: 'object',
    required: 'no',
    descKey: 'promptApiReqVariablesDesc',
    defaultDesc: 'Prompt template variables.',
  },
  {
    name: 'attachments',
    type: 'array',
    required: 'no',
    descKey: 'promptApiReqAttachmentsDesc',
    defaultDesc: 'Supports image_url / file / file_ref.',
  },
  {
    name: 'stream',
    type: 'boolean',
    required: 'no',
    descKey: 'promptApiReqStreamDesc',
    defaultDesc: 'Enable SSE stream.',
  },
  {
    name: 'saveTrace',
    type: 'boolean',
    required: 'no',
    descKey: 'promptApiReqSaveTraceDesc',
    defaultDesc: 'Keep true if you need multi-turn history persistence.',
  },
];

const RESPONSE_HEADER_DEFS: RowDef[] = [
  {
    name: 'X-Prompt-Id',
    type: 'uuid',
    required: 'yes',
    descKey: 'promptApiResPromptIdDesc',
    defaultDesc: 'Resolved prompt id.',
  },
  {
    name: 'X-Prompt-Version',
    type: 'number',
    required: 'yes',
    descKey: 'promptApiResPromptVersionDesc',
    defaultDesc: 'Resolved prompt version.',
  },
  {
    name: 'X-Conversation-Id',
    type: 'string',
    required: 'yes',
    descKey: 'promptApiResConversationIdDesc',
    defaultDesc: 'When first turn omits conversationId, read this header and reuse it in later turns.',
  },
  {
    name: 'X-Conversation-History-Count',
    type: 'number',
    required: 'yes',
    descKey: 'promptApiResHistoryCountDesc',
    defaultDesc: 'Merged historical turn count.',
  },
];

function getKeyStatus(key: PromptApiKey): 'active' | 'expired' | 'revoked' {
  if (key.revokedAt) return 'revoked';
  if (key.expiresAt && new Date(key.expiresAt).getTime() <= Date.now()) return 'expired';
  return 'active';
}

function localInputValueToIso(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
}

function buildPromptVersionDraft(prompt: Pick<PromptListItem, 'apiVersionMode' | 'apiFixedVersion'>): {
  mode: PromptApiVersionMode;
  fixedVersion: string;
} {
  return {
    mode: (prompt.apiVersionMode || 'latest') as PromptApiVersionMode,
    fixedVersion: prompt.apiFixedVersion ? String(prompt.apiFixedVersion) : '',
  };
}

export function PromptApiKeysManager() {
  const { t } = useTranslation('settings');
  const { t: tCommon } = useTranslation('common');
  const { showToast } = useToast();
  const [keys, setKeys] = useState<PromptApiKey[]>([]);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [promptsLoading, setPromptsLoading] = useState(false);
  const [updatingPromptId, setUpdatingPromptId] = useState<string | null>(null);
  const [promptQuery, setPromptQuery] = useState('');
  const [name, setName] = useState('');
  const [expiresAtInput, setExpiresAtInput] = useState('');
  const [prompts, setPrompts] = useState<PromptListItem[]>([]);
  const [promptGroups, setPromptGroups] = useState<PromptGroup[]>([]);
  const [promptVersionDrafts, setPromptVersionDrafts] = useState<
    Record<string, { mode: PromptApiVersionMode; fixedVersion: string }>
  >({});
  const [createdApiKey, setCreatedApiKey] = useState<string | null>(null);
  const [copiedCreatedKey, setCopiedCreatedKey] = useState(false);
  const [copiedInvokeUrl, setCopiedInvokeUrl] = useState(false);
  const [copiedPromptInvokeId, setCopiedPromptInvokeId] = useState<string | null>(null);
  const [copiedSpecSnippet, setCopiedSpecSnippet] = useState<'curl' | 'sse' | null>(null);
  const [activeSpecTab, setActiveSpecTab] = useState<SpecTab>('overview');

  const invokeUrl = useMemo(() => `${API_BASE_URL}/open/prompts/{promptId}/invoke`, []);
  const invokeUrlExample = useMemo(() => invokeUrl.replace('{promptId}', '<prompt_id>'), [invokeUrl]);
  const promptGroupPathMap = useMemo(() => {
    const groupById = new Map(promptGroups.map((group) => [group.id, group]));
    const pathById = new Map<string, string>();

    const resolvePath = (groupId: string): string => {
      if (pathById.has(groupId)) return pathById.get(groupId) as string;
      const chain: string[] = [];
      const visited = new Set<string>();
      let current: PromptGroup | undefined = groupById.get(groupId);

      while (current && !visited.has(current.id)) {
        visited.add(current.id);
        chain.push(current.name);
        current = current.parentId ? groupById.get(current.parentId) : undefined;
      }

      const resolved = chain.reverse().join(' / ');
      pathById.set(groupId, resolved);
      return resolved;
    };

    promptGroups.forEach((group) => {
      resolvePath(group.id);
    });
    return pathById;
  }, [promptGroups]);

  const filteredPrompts = useMemo(() => {
    const query = promptQuery.trim().toLowerCase();
    if (!query) return prompts;
    return prompts.filter((item) => {
      const nameMatch = item.name.toLowerCase().includes(query);
      const idMatch = item.id.toLowerCase().includes(query);
      const descMatch = item.description?.toLowerCase().includes(query) ?? false;
      const groupPath = item.groupId ? (promptGroupPathMap.get(item.groupId) || '') : '';
      const groupMatch = groupPath.toLowerCase().includes(query);
      return nameMatch || idMatch || descMatch || groupMatch;
    });
  }, [promptGroupPathMap, promptQuery, prompts]);

  const mapRows = useCallback(
    (defs: RowDef[]): SpecRow[] =>
      defs.map((item) => ({
        name: item.name,
        type: item.type,
        required: item.required === 'yes' ? t('promptApiRequiredYes', { defaultValue: 'Yes' }) : t('promptApiRequiredNo', { defaultValue: 'No' }),
        description: t(item.descKey, { defaultValue: item.defaultDesc }),
      })),
    [t]
  );

  const requestHeaders = useMemo(() => mapRows(REQUEST_HEADER_DEFS), [mapRows]);
  const requestBody = useMemo(() => mapRows(REQUEST_BODY_DEFS), [mapRows]);
  const responseHeaders = useMemo(() => mapRows(RESPONSE_HEADER_DEFS), [mapRows]);

  const requestExample = useMemo(
    () =>
      JSON.stringify(
        {
          conversationId: 'conv_order_assistant_001',
          input: 'Summarize this shipment order',
          variables: { language: 'zh-CN' },
          stream: false,
          saveTrace: true,
        },
        null,
        2
      ),
    []
  );

  const successExample = useMemo(
    () =>
      JSON.stringify(
        {
          data: {
            content: '{"summary":"..."}',
            usage: { prompt_tokens: 321, completion_tokens: 89, total_tokens: 410 },
            latencyMs: 1280,
          },
        },
        null,
        2
      ),
    []
  );

  const errorExample = useMemo(
    () =>
      JSON.stringify(
        {
          error: {
            code: 'INVALID_REQUEST',
            message: 'No model configured for this prompt',
            requestId: 'req_1234567890',
          },
        },
        null,
        2
      ),
    []
  );

  const curlExample = useMemo(
    () =>
      [
        `curl -X POST "${invokeUrlExample}" \\`,
        '  -H "Authorization: Bearer <prompt_api_key>" \\',
        '  -H "Content-Type: application/json" \\',
        "  -d '{",
        '    "conversationId":"conv_order_assistant_001",',
        '    "input":"Summarize this shipment order",',
        '    "stream":false',
        "  }'",
      ].join('\n'),
    [invokeUrlExample]
  );

  const sseExample = useMemo(
    () =>
      [
        `curl -N -X POST "${invokeUrlExample}" \\`,
        '  -H "X-API-Key: <prompt_api_key>" \\',
        '  -H "Accept: text/event-stream" \\',
        '  -H "Content-Type: application/json" \\',
        "  -d '{\"conversationId\":\"conv_order_assistant_001\",\"input\":\"next turn\",\"stream\":true}'",
      ].join('\n'),
    [invokeUrlExample]
  );

  const tabs = useMemo(
    () => [
      { id: 'overview' as const, label: t('promptApiTabOverview', { defaultValue: 'Overview' }) },
      { id: 'request' as const, label: t('promptApiTabRequest', { defaultValue: 'Request' }) },
      { id: 'response' as const, label: t('promptApiTabResponse', { defaultValue: 'Response' }) },
      { id: 'examples' as const, label: t('promptApiTabExamples', { defaultValue: 'Examples' }) },
      { id: 'multiturn' as const, label: t('promptApiTabMultiturn', { defaultValue: 'Multi-turn' }) },
    ],
    [t]
  );

  const loadKeys = useCallback(async () => {
    setLoading(true);
    try {
      const data = await promptApiKeysApi.list();
      setKeys(data);
    } catch (error) {
      showToast('error', `${t('loadFailed')}: ${getErrorMessage(error)}`);
    } finally {
      setLoading(false);
    }
  }, [showToast, t]);

  useEffect(() => {
    void loadKeys();
  }, [loadKeys]);

  const loadPrompts = useCallback(async () => {
    setPromptsLoading(true);
    try {
      const [promptList, groupList] = await Promise.all([
        promptsApi.list(),
        promptGroupsApi.list(),
      ]);
      setPrompts(promptList);
      setPromptGroups(groupList);
      setPromptVersionDrafts(
        promptList.reduce<Record<string, { mode: PromptApiVersionMode; fixedVersion: string }>>((acc, prompt) => {
          acc[prompt.id] = buildPromptVersionDraft(prompt);
          return acc;
        }, {})
      );
    } catch (error) {
      showToast('error', `${t('loadFailed')}: ${getErrorMessage(error)}`);
    } finally {
      setPromptsLoading(false);
    }
  }, [showToast, t]);

  useEffect(() => {
    void loadPrompts();
  }, [loadPrompts]);

  const buildPromptInvokeUrl = useCallback(
    (promptId: string) => invokeUrl.replace('{promptId}', promptId),
    [invokeUrl]
  );

  const formatPromptCallableVersion = useCallback(
    (prompt: PromptListItem): string => {
      if (prompt.apiVersionMode === 'fixed') {
        const version = prompt.apiFixedVersion ?? prompt.currentVersion;
        return t('promptApiModeFixedLabel', { defaultValue: `Fixed v${version}`, version });
      }
      return t('promptApiModeLatestLabel', {
        defaultValue: `Latest (current v${prompt.currentVersion})`,
        version: prompt.currentVersion,
      });
    },
    [t]
  );

  const handleUpdatePromptVersionMode = (promptId: string, mode: PromptApiVersionMode) => {
    setPromptVersionDrafts((prev) => {
      const current = prev[promptId] || { mode: 'latest' as PromptApiVersionMode, fixedVersion: '' };
      return {
        ...prev,
        [promptId]: {
          mode,
          fixedVersion: mode === 'fixed' ? current.fixedVersion : '',
        },
      };
    });
  };

  const handleUpdatePromptFixedVersion = (promptId: string, fixedVersion: string) => {
    setPromptVersionDrafts((prev) => {
      const current = prev[promptId] || { mode: 'latest' as PromptApiVersionMode, fixedVersion: '' };
      return {
        ...prev,
        [promptId]: {
          ...current,
          fixedVersion,
        },
      };
    });
  };

  const handleAdjustPromptFixedVersion = (promptId: string, currentVersion: number, delta: 1 | -1) => {
    setPromptVersionDrafts((prev) => {
      const current = prev[promptId] || { mode: 'fixed' as PromptApiVersionMode, fixedVersion: '' };
      const parsed = Number.parseInt(current.fixedVersion.trim(), 10);
      const base = Number.isNaN(parsed) ? (delta > 0 ? 0 : 2) : parsed;
      const next = Math.max(1, Math.min(currentVersion, base + delta));
      return {
        ...prev,
        [promptId]: {
          ...current,
          fixedVersion: String(next),
        },
      };
    });
  };

  const isVersionDraftDirty = useCallback(
    (prompt: PromptListItem) => {
      const current = buildPromptVersionDraft(prompt);
      const draft = promptVersionDrafts[prompt.id] || current;
      if (draft.mode !== current.mode) return true;
      if (draft.mode === 'fixed') {
        return draft.fixedVersion.trim() !== current.fixedVersion.trim();
      }
      return false;
    },
    [promptVersionDrafts]
  );

  const handleSavePromptVersionConfig = async (prompt: PromptListItem) => {
    if (updatingPromptId) return;
    const draft = promptVersionDrafts[prompt.id] || buildPromptVersionDraft(prompt);
    if (!isVersionDraftDirty(prompt)) return;

    let parsedFixedVersion: number | null = null;
    if (draft.mode === 'fixed') {
      const trimmedFixedVersion = draft.fixedVersion.trim();
      const parsed = Number.parseInt(trimmedFixedVersion, 10);
      if (!trimmedFixedVersion || Number.isNaN(parsed) || parsed <= 0) {
        showToast(
          'error',
          t('promptApiFixedVersionRequiredError', {
            defaultValue: 'Please set a valid fixed version number',
          })
        );
        return;
      }
      if (parsed > prompt.currentVersion) {
        showToast(
          'error',
          t('promptApiFixedVersionExceedCurrentError', {
            defaultValue: 'Fixed version cannot exceed current version v{{version}}',
            version: prompt.currentVersion,
          })
        );
        return;
      }
      parsedFixedVersion = parsed;
    }

    setUpdatingPromptId(prompt.id);
    try {
      const updated = await promptsApi.update(prompt.id, {
        apiVersionMode: draft.mode,
        apiFixedVersion: draft.mode === 'fixed' ? parsedFixedVersion : null,
      });
      setPrompts((prev) =>
        prev.map((item) =>
          item.id === prompt.id
            ? {
                ...item,
                apiEnabled: updated.apiEnabled,
                apiVersionMode: updated.apiVersionMode,
                apiFixedVersion: updated.apiFixedVersion,
                currentVersion: updated.currentVersion,
                updatedAt: updated.updatedAt,
              }
            : item
        )
      );
      setPromptVersionDrafts((prev) => ({
        ...prev,
        [prompt.id]: buildPromptVersionDraft(updated),
      }));
      invalidatePromptsCache(updated);
      showToast('success', t('configSaved'));
    } catch (error) {
      showToast('error', `${t('saveConfigFailed')}: ${getErrorMessage(error)}`);
    } finally {
      setUpdatingPromptId(null);
    }
  };

  const handleTogglePromptApiEnabled = async (prompt: PromptListItem, enabled: boolean) => {
    if (updatingPromptId) return;
    setUpdatingPromptId(prompt.id);
    try {
      const updated = await promptsApi.update(prompt.id, {
        apiEnabled: enabled,
      });
      setPrompts((prev) =>
        prev.map((item) =>
          item.id === prompt.id
            ? {
                ...item,
                apiEnabled: updated.apiEnabled,
                apiVersionMode: updated.apiVersionMode,
                apiFixedVersion: updated.apiFixedVersion,
                currentVersion: updated.currentVersion,
                updatedAt: updated.updatedAt,
              }
            : item
        )
      );
      setPromptVersionDrafts((prev) => ({
        ...prev,
        [prompt.id]: buildPromptVersionDraft(updated),
      }));
      invalidatePromptsCache(updated);
      showToast('success', t('configSaved'));
    } catch (error) {
      showToast('error', `${t('saveConfigFailed')}: ${getErrorMessage(error)}`);
    } finally {
      setUpdatingPromptId(null);
    }
  };

  const handleCopyPromptInvokeUrl = async (promptId: string) => {
    try {
      await navigator.clipboard.writeText(buildPromptInvokeUrl(promptId));
      setCopiedPromptInvokeId(promptId);
      showToast('success', tCommon('copied'));
      setTimeout(() => {
        setCopiedPromptInvokeId((prev) => (prev === promptId ? null : prev));
      }, 1500);
    } catch {
      showToast('error', t('copyFailed', { defaultValue: 'Copy failed' }));
    }
  };

  const handleCreate = async () => {
    const trimmedName = name.trim();
    if (!trimmedName) {
      showToast('error', t('nameRequired', { defaultValue: 'Name is required' }));
      return;
    }

    setCreating(true);
    try {
      const expiresAt = localInputValueToIso(expiresAtInput);
      const result = await promptApiKeysApi.create({ name: trimmedName, expiresAt });
      setCreatedApiKey(result.apiKey);
      setCopiedCreatedKey(false);
      setKeys((prev) => [result.key, ...prev]);
      showToast('success', t('settingsSaved', { defaultValue: 'Saved' }));
    } catch (error) {
      showToast('error', `${t('saveConfigFailed', { defaultValue: 'Save failed' })}: ${getErrorMessage(error)}`);
    } finally {
      setCreating(false);
    }
  };

  const handleRevoke = async (id: string) => {
    setRevokingId(id);
    try {
      const revoked = await promptApiKeysApi.revoke(id);
      setKeys((prev) => prev.map((item) => (item.id === id ? revoked : item)));
      showToast('success', t('settingsSaved', { defaultValue: 'Saved' }));
    } catch (error) {
      showToast('error', `${t('saveConfigFailed', { defaultValue: 'Save failed' })}: ${getErrorMessage(error)}`);
    } finally {
      setRevokingId(null);
    }
  };

  const handleCopyCreatedKey = async () => {
    if (!createdApiKey) return;
    try {
      await navigator.clipboard.writeText(createdApiKey);
      setCopiedCreatedKey(true);
      showToast('success', tCommon('copied'));
    } catch {
      showToast('error', t('copyFailed', { defaultValue: 'Copy failed' }));
    }
  };

  const handleCopyInvokeUrl = async () => {
    try {
      await navigator.clipboard.writeText(invokeUrl);
      setCopiedInvokeUrl(true);
      showToast('success', tCommon('copied'));
      setTimeout(() => setCopiedInvokeUrl(false), 1500);
    } catch {
      showToast('error', t('copyFailed', { defaultValue: 'Copy failed' }));
    }
  };

  const handleCopySpecSnippet = async (snippet: string, snippetId: 'curl' | 'sse') => {
    try {
      await navigator.clipboard.writeText(snippet);
      setCopiedSpecSnippet(snippetId);
      showToast('success', tCommon('copied'));
      setTimeout(() => {
        setCopiedSpecSnippet((prev) => (prev === snippetId ? null : prev));
      }, 1500);
    } catch {
      showToast('error', t('copyFailed', { defaultValue: 'Copy failed' }));
    }
  };

  const renderTable = (rows: SpecRow[]) => (
    <div className="overflow-x-auto rounded-md border border-slate-700 light:border-slate-200">
      <table className="w-full text-sm text-left text-slate-300 light:text-slate-700">
        <thead className="bg-slate-900/70 light:bg-slate-100">
          <tr>
            <th className="px-2 py-2 font-medium">{t('promptApiTableField', { defaultValue: 'Field' })}</th>
            <th className="px-2 py-2 font-medium">{t('promptApiTableType', { defaultValue: 'Type' })}</th>
            <th className="px-2 py-2 font-medium">{t('promptApiTableRequired', { defaultValue: 'Required' })}</th>
            <th className="px-2 py-2 font-medium">{t('promptApiTableDescription', { defaultValue: 'Description' })}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={`${row.name}-${row.type}`} className="border-t border-slate-700 light:border-slate-200">
              <td className="px-2 py-2 align-top font-mono text-xs text-cyan-300 light:text-cyan-700">{row.name}</td>
              <td className="px-2 py-2 align-top font-mono text-xs">{row.type}</td>
              <td className="px-2 py-2 align-top">{row.required}</td>
              <td className="px-2 py-2 align-top">{row.description}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

  return (
    <div className="flex-1 overflow-hidden">
      <div className="w-full h-full p-6 overflow-y-auto">
        <div className="space-y-4 min-h-full">
          <div className="w-full grid grid-cols-1 2xl:grid-cols-[minmax(0,1fr)_minmax(460px,0.9fr)] gap-4">
          <div className="rounded-xl border border-slate-700 light:border-slate-200 bg-slate-900/40 light:bg-white p-4 space-y-3">
            <div className="flex items-center gap-2">
              <KeyRound className="w-4 h-4 text-cyan-400" />
              <h3 className="text-lg font-medium text-slate-100 light:text-slate-900">
                {t('promptApiAccessTitle', { defaultValue: 'Prompt API Access' })}
              </h3>
            </div>
            <p className="text-sm text-slate-400 light:text-slate-600">
              {t('promptApiAccessDesc', {
                defaultValue: 'Use one invoke URL and switch prompts by replacing promptId. Only prompts with API access enabled can be called.',
              })}
            </p>
            <div className="flex items-center gap-2">
              <code className="flex-1 rounded-md bg-slate-950 light:bg-slate-100 border border-slate-800 light:border-slate-200 px-3 py-2 text-xs text-cyan-300 light:text-cyan-700 break-all">
                {invokeUrl}
              </code>
              <Button variant="secondary" size="sm" onClick={() => void handleCopyInvokeUrl()}>
                {copiedInvokeUrl ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
              </Button>
            </div>
          </div>

          <div className="rounded-xl border border-slate-700 light:border-slate-200 bg-slate-900/40 light:bg-white p-4 space-y-3">
            <h4 className="text-lg font-medium text-slate-100 light:text-slate-900">
              {t('createApiKey', { defaultValue: 'Create API Key' })}
            </h4>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <Input
                label={tCommon('name')}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t('apiKeyNamePlaceholder', { defaultValue: 'e.g. CRM production' })}
              />
              <Input
                label={t('expireAtOptional', { defaultValue: 'Expires At (optional)' })}
                type="datetime-local"
                value={expiresAtInput}
                onChange={(e) => setExpiresAtInput(e.target.value)}
              />
            </div>
            <div className="flex justify-end">
              <Button onClick={() => void handleCreate()} loading={creating}>
                {tCommon('create')}
              </Button>
            </div>

            {createdApiKey && (
              <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 space-y-2">
                <p className="text-xs text-amber-200 light:text-amber-700">
                  {t('apiKeyShowOnceHint', { defaultValue: 'The full API key is shown only once. Copy it now.' })}
                </p>
                <div className="flex items-center gap-2">
                  <code className="flex-1 rounded-md bg-slate-950 light:bg-slate-100 border border-slate-800 light:border-slate-200 px-3 py-2 text-xs text-amber-200 light:text-amber-800 break-all">
                    {createdApiKey}
                  </code>
                  <Button variant="secondary" size="sm" onClick={() => void handleCopyCreatedKey()}>
                    {copiedCreatedKey ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                  </Button>
                </div>
              </div>
            )}
          </div>
        </div>

          <div className="rounded-xl border border-slate-700 light:border-slate-200 bg-slate-900/40 light:bg-white p-4 flex flex-col gap-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h4 className="text-lg font-medium text-slate-100 light:text-slate-900">
                  {t('promptApiManageTitle', { defaultValue: 'Prompt API Access Management' })}
                </h4>
                <p className="text-sm text-slate-400 light:text-slate-600 mt-1">
                  {t('promptApiManageDesc', {
                    defaultValue: 'Manage API access for all prompts and copy each prompt invoke URL from one place.',
                  })}
                </p>
              </div>
              <Button variant="secondary" size="sm" onClick={() => void loadPrompts()} loading={promptsLoading}>
                <span>{tCommon('refresh')}</span>
              </Button>
            </div>

            <div className="w-full max-w-sm">
              <Input
                value={promptQuery}
                onChange={(event) => setPromptQuery(event.target.value)}
                placeholder={t('promptApiPromptSearchPlaceholder', {
                  defaultValue: 'Search prompt name or ID...',
                })}
              />
            </div>

            {promptsLoading ? (
              <div className="py-6 text-sm text-slate-400 light:text-slate-600 flex items-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>{tCommon('loading')}</span>
              </div>
            ) : prompts.length === 0 ? (
              <div className="py-8 text-sm text-slate-400 light:text-slate-600 border border-dashed border-slate-700 light:border-slate-200 rounded-lg text-center">
                {t('promptApiNoPrompts', { defaultValue: 'No prompts available' })}
              </div>
            ) : filteredPrompts.length === 0 ? (
              <div className="py-8 text-sm text-slate-400 light:text-slate-600 border border-dashed border-slate-700 light:border-slate-200 rounded-lg text-center">
                {t('promptApiNoMatchingPrompts', { defaultValue: 'No matching prompts found' })}
              </div>
            ) : (
              <div className="overflow-x-auto rounded-md border border-slate-700 light:border-slate-200">
                <table className="w-full text-sm text-left text-slate-300 light:text-slate-700">
                  <thead className="bg-slate-900/70 light:bg-slate-100">
                    <tr>
                      <th className="px-3 py-2 font-medium min-w-[220px]">
                        {t('promptApiPromptColumn', { defaultValue: 'Prompt' })}
                      </th>
                      <th className="px-3 py-2 font-medium min-w-[220px]">
                        {t('promptApiGroupColumn', { defaultValue: 'Category Path' })}
                      </th>
                      <th className="px-3 py-2 font-medium min-w-[170px]">
                        {t('promptApiAccessColumn', { defaultValue: 'API Access' })}
                      </th>
                      <th className="px-3 py-2 font-medium min-w-[260px]">
                        {t('promptApiVersionConfigColumn', { defaultValue: 'Version Config' })}
                      </th>
                      <th className="px-3 py-2 font-medium min-w-[300px]">
                        {t('promptApiInvokeUrlColumn', { defaultValue: 'Invoke URL' })}
                      </th>
                      <th className="px-3 py-2 font-medium w-[100px]">{tCommon('actions')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredPrompts.map((prompt) => {
                      const isUpdating = updatingPromptId === prompt.id;
                      const versionDraft = promptVersionDrafts[prompt.id] || buildPromptVersionDraft(prompt);
                      const statusLabel = prompt.apiEnabled
                        ? t('promptApiAccessEnabled', { defaultValue: 'Enabled' })
                        : t('promptApiAccessDisabled', { defaultValue: 'Disabled' });
                      const promptInvokeUrl = buildPromptInvokeUrl(prompt.id);
                      const promptGroupPath =
                        (prompt.groupId ? promptGroupPathMap.get(prompt.groupId) : null) ||
                        t('promptApiUngrouped', { defaultValue: 'Ungrouped' });
                      return (
                        <tr key={prompt.id} className="border-t border-slate-700 light:border-slate-200">
                          <td className="px-3 py-2 align-top">
                            <div className="text-sm text-slate-100 light:text-slate-900 truncate">{prompt.name}</div>
                            <div className="text-xs text-slate-500 light:text-slate-600 truncate mt-0.5">{prompt.id}</div>
                          </td>
                          <td className="px-3 py-2 align-top">
                            <span className="text-xs text-slate-300 light:text-slate-700">{promptGroupPath}</span>
                          </td>
                          <td className="px-3 py-2 align-top">
                            <div className="flex items-center gap-2">
                              <Toggle
                                checked={prompt.apiEnabled}
                                onChange={(enabled) => void handleTogglePromptApiEnabled(prompt, enabled)}
                                disabled={isUpdating}
                                size="sm"
                              />
                              <span
                                className={`text-xs px-2 py-0.5 rounded-full ${
                                  prompt.apiEnabled
                                    ? 'bg-emerald-500/15 text-emerald-300 light:text-emerald-700'
                                    : 'bg-slate-600/20 text-slate-300 light:text-slate-600'
                                }`}
                              >
                                {statusLabel}
                              </span>
                              {isUpdating && <Loader2 className="w-3.5 h-3.5 animate-spin text-cyan-400" />}
                            </div>
                          </td>
                          <td className="px-3 py-2 align-top">
                            <div className="flex items-center gap-2">
                              <select
                                value={versionDraft.mode}
                                onChange={(event) =>
                                  handleUpdatePromptVersionMode(prompt.id, event.target.value as PromptApiVersionMode)
                                }
                                disabled={isUpdating}
                                className="min-w-[120px] rounded-md border border-slate-700 light:border-slate-300 bg-slate-900 light:bg-white px-2 py-1.5 text-xs text-slate-200 light:text-slate-800 focus:outline-none focus:ring-2 focus:ring-cyan-500/40"
                              >
                                <option value="latest">
                                  {t('promptApiVersionModeLatestOption', { defaultValue: 'Latest (current)' })}
                                </option>
                                <option value="fixed">
                                  {t('promptApiVersionModeFixedOption', { defaultValue: 'Fixed version' })}
                                </option>
                              </select>
                              {versionDraft.mode === 'fixed' && (
                                <div className="inline-flex w-[108px] overflow-hidden rounded-md border border-slate-700 light:border-slate-300 bg-slate-900 light:bg-white focus-within:ring-2 focus-within:ring-cyan-500/40">
                                  <input
                                    type="text"
                                    inputMode="numeric"
                                    value={versionDraft.fixedVersion}
                                    onChange={(event) =>
                                      handleUpdatePromptFixedVersion(
                                        prompt.id,
                                        event.target.value.replace(/[^\d]/g, '')
                                      )
                                    }
                                    placeholder={t('promptApiFixedVersionPlaceholder', { defaultValue: 'Version number' })}
                                    disabled={isUpdating}
                                    className="w-full bg-transparent px-2 py-1.5 text-xs text-slate-200 light:text-slate-800 focus:outline-none"
                                  />
                                  <div className="flex flex-col border-l border-slate-700 light:border-slate-300">
                                    <button
                                      type="button"
                                      onClick={() => handleAdjustPromptFixedVersion(prompt.id, prompt.currentVersion, 1)}
                                      disabled={isUpdating}
                                      className="h-[13px] w-6 flex items-center justify-center text-slate-400 light:text-slate-500 hover:bg-slate-800 light:hover:bg-slate-100 disabled:opacity-50"
                                      aria-label={t('promptApiIncreaseVersion', { defaultValue: 'Increase version' })}
                                    >
                                      <ChevronUp className="h-3 w-3" />
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => handleAdjustPromptFixedVersion(prompt.id, prompt.currentVersion, -1)}
                                      disabled={isUpdating}
                                      className="h-[13px] w-6 flex items-center justify-center border-t border-slate-700 light:border-slate-300 text-slate-400 light:text-slate-500 hover:bg-slate-800 light:hover:bg-slate-100 disabled:opacity-50"
                                      aria-label={t('promptApiDecreaseVersion', { defaultValue: 'Decrease version' })}
                                    >
                                      <ChevronDown className="h-3 w-3" />
                                    </button>
                                  </div>
                                </div>
                              )}
                              <Button
                                variant="secondary"
                                size="sm"
                                onClick={() => void handleSavePromptVersionConfig(prompt)}
                                loading={isUpdating}
                                disabled={isUpdating || !isVersionDraftDirty(prompt)}
                              >
                                {tCommon('save')}
                              </Button>
                              <span className="text-[11px] text-slate-500 light:text-slate-600 whitespace-nowrap">
                                {formatPromptCallableVersion(prompt)}
                              </span>
                            </div>
                          </td>
                          <td className="px-3 py-2 align-top">
                            <code className="block text-xs text-cyan-300 light:text-cyan-700 truncate" title={promptInvokeUrl}>
                              {promptInvokeUrl}
                            </code>
                          </td>
                          <td className="px-3 py-2 align-top">
                            <Button variant="secondary" size="sm" onClick={() => void handleCopyPromptInvokeUrl(prompt.id)}>
                              {copiedPromptInvokeId === prompt.id ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                            </Button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="w-full grid grid-cols-1 2xl:grid-cols-[380px_minmax(0,1fr)] gap-4 min-h-[460px]">
          <div className="rounded-xl border border-slate-700 light:border-slate-200 bg-slate-900/40 light:bg-white p-4 flex flex-col gap-3 min-h-0">
            <h4 className="text-lg font-medium text-slate-100 light:text-slate-900">{t('apiKeyList', { defaultValue: 'API Keys' })}</h4>

            {loading ? (
              <p className="text-sm text-slate-400 light:text-slate-600">{tCommon('loading')}</p>
            ) : keys.length === 0 ? (
              <p className="text-sm text-slate-400 light:text-slate-600">{tCommon('noData')}</p>
            ) : (
              <div className="flex-1 min-h-0 overflow-y-auto pr-1 space-y-2">
                {keys.map((key) => {
                  const status = getKeyStatus(key);
                  const statusText =
                    status === 'active'
                      ? t('active', { defaultValue: 'Active' })
                      : status === 'expired'
                        ? t('expired', { defaultValue: 'Expired' })
                        : t('revoked', { defaultValue: 'Revoked' });

                  return (
                    <div key={key.id} className="flex items-center justify-between gap-3 rounded-lg border border-slate-700 light:border-slate-200 bg-slate-900/40 light:bg-slate-50 px-3 py-2">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm text-slate-200 light:text-slate-800 truncate">{key.name}</span>
                          <span className={`text-[11px] px-2 py-0.5 rounded-full ${status === 'active' ? 'bg-emerald-500/15 text-emerald-300 light:text-emerald-700' : status === 'expired' ? 'bg-amber-500/15 text-amber-300 light:text-amber-700' : 'bg-rose-500/15 text-rose-300 light:text-rose-700'}`}>
                            {statusText}
                          </span>
                        </div>
                        <p className="text-xs text-slate-500 light:text-slate-600 mt-0.5">{`${key.keyPrefix}...${key.keyLast4}`}</p>
                        <p className="text-xs text-slate-500 light:text-slate-600 mt-0.5">
                          {t('lastUsedAt', { defaultValue: 'Last used' })}: {formatDateTime(key.lastUsedAt)} {' | '}
                          {t('expireAtOptional', { defaultValue: 'Expires At (optional)' })}: {formatDateTime(key.expiresAt)}
                        </p>
                      </div>
                      <Button variant="ghost" size="sm" disabled={status !== 'active'} loading={revokingId === key.id} onClick={() => void handleRevoke(key.id)}>
                        <Ban className="w-4 h-4" />
                        <span>{t('revoke', { defaultValue: 'Revoke' })}</span>
                      </Button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div className="rounded-xl border border-slate-700 light:border-slate-200 bg-slate-900/40 light:bg-white p-4 flex flex-col gap-4 min-h-0">
            <div className="flex items-center gap-2">
              <BookOpenText className="w-4 h-4 text-cyan-400" />
              <h4 className="text-lg font-medium text-slate-100 light:text-slate-900">{t('promptApiSpecTitle', { defaultValue: 'Invoke API Spec' })}</h4>
            </div>

            <div className="flex flex-wrap gap-2">
              {tabs.map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveSpecTab(tab.id)}
                  className={`px-3 py-1.5 rounded-md text-sm transition-colors border ${tab.id === activeSpecTab ? 'border-cyan-500 bg-cyan-500/15 text-cyan-300 light:text-cyan-700' : 'border-slate-700 light:border-slate-200 text-slate-400 light:text-slate-600 hover:text-slate-200 light:hover:text-slate-800'}`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            <div className="flex-1 min-h-0 overflow-y-auto pr-1">
              {activeSpecTab === 'overview' && (
                <div className="space-y-3">
                  <p className="text-sm font-medium text-slate-200 light:text-slate-800">{t('promptApiSectionEndpoint', { defaultValue: 'Endpoint' })}</p>
                  <code className="block rounded-md bg-slate-950 light:bg-slate-100 border border-slate-800 light:border-slate-200 px-3 py-2 text-sm text-cyan-300 light:text-cyan-700 break-all">
                    POST {invokeUrlExample}
                  </code>
                  <p className="text-sm font-medium text-slate-200 light:text-slate-800">{t('promptApiSectionRequestHeaders', { defaultValue: 'Request Headers' })}</p>
                  {renderTable(requestHeaders)}
                </div>
              )}

              {activeSpecTab === 'request' && (
                <div className="space-y-3">
                  <p className="text-sm font-medium text-slate-200 light:text-slate-800">{t('promptApiSectionRequestBody', { defaultValue: 'Request Body' })}</p>
                  {renderTable(requestBody)}
                  <p className="text-sm font-medium text-slate-200 light:text-slate-800">{t('promptApiSectionRequestExample', { defaultValue: 'Request Example' })}</p>
                  <pre className="rounded-md bg-slate-950 light:bg-slate-100 border border-slate-800 light:border-slate-200 px-3 py-2 text-[11px] text-slate-300 light:text-slate-700 overflow-auto">{requestExample}</pre>
                </div>
              )}

              {activeSpecTab === 'response' && (
                <div className="space-y-3">
                  <p className="text-sm font-medium text-slate-200 light:text-slate-800">{t('promptApiSectionResponseHeaders', { defaultValue: 'Response Headers' })}</p>
                  {renderTable(responseHeaders)}
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                    <div>
                      <p className="text-sm font-medium text-slate-200 light:text-slate-800 mb-2">{t('promptApiSectionSuccessResponse', { defaultValue: 'Success Response' })}</p>
                      <pre className="rounded-md bg-slate-950 light:bg-slate-100 border border-slate-800 light:border-slate-200 px-3 py-2 text-[11px] text-slate-300 light:text-slate-700 overflow-auto">{successExample}</pre>
                    </div>
                    <div>
                      <p className="text-sm font-medium text-slate-200 light:text-slate-800 mb-2">{t('promptApiSectionErrorResponse', { defaultValue: 'Error Response' })}</p>
                      <pre className="rounded-md bg-slate-950 light:bg-slate-100 border border-slate-800 light:border-slate-200 px-3 py-2 text-[11px] text-slate-300 light:text-slate-700 overflow-auto">{errorExample}</pre>
                    </div>
                  </div>
                </div>
              )}

              {activeSpecTab === 'examples' && (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                  <div>
                    <div className="flex items-center justify-between mb-2 gap-2">
                      <p className="text-sm font-medium text-slate-200 light:text-slate-800">
                        {t('promptApiSectionCurl', { defaultValue: 'cURL (stream=false)' })}
                      </p>
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => void handleCopySpecSnippet(curlExample, 'curl')}
                      >
                        {copiedSpecSnippet === 'curl' ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                        <span>{copiedSpecSnippet === 'curl' ? tCommon('copied') : tCommon('copy')}</span>
                      </Button>
                    </div>
                    <pre className="rounded-md bg-slate-950 light:bg-slate-100 border border-slate-800 light:border-slate-200 px-3 py-2 text-[11px] text-slate-300 light:text-slate-700 overflow-auto">{curlExample}</pre>
                  </div>
                  <div>
                    <div className="flex items-center justify-between mb-2 gap-2">
                      <p className="text-sm font-medium text-slate-200 light:text-slate-800">
                        {t('promptApiSectionCurlSse', { defaultValue: 'cURL (stream=true / SSE)' })}
                      </p>
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => void handleCopySpecSnippet(sseExample, 'sse')}
                      >
                        {copiedSpecSnippet === 'sse' ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                        <span>{copiedSpecSnippet === 'sse' ? tCommon('copied') : tCommon('copy')}</span>
                      </Button>
                    </div>
                    <pre className="rounded-md bg-slate-950 light:bg-slate-100 border border-slate-800 light:border-slate-200 px-3 py-2 text-[11px] text-slate-300 light:text-slate-700 overflow-auto">{sseExample}</pre>
                  </div>
                </div>
              )}

              {activeSpecTab === 'multiturn' && (
                <div className="rounded-lg border border-slate-700 light:border-slate-200 bg-slate-900/40 light:bg-slate-50 p-3">
                  <p className="text-sm text-slate-300 light:text-slate-700 font-medium mb-2">{t('promptApiSectionMultiturn', { defaultValue: 'Multi-turn Workflow' })}</p>
                  <ol className="list-decimal list-inside text-sm text-slate-400 light:text-slate-600 space-y-1">
                    <li>{t('promptApiMultiturnStep1', { defaultValue: 'First turn: send input only, or provide your own conversationId.' })}</li>
                    <li>{t('promptApiMultiturnStep2', { defaultValue: 'If first turn omits conversationId, read X-Conversation-Id from response headers.' })}</li>
                    <li>{t('promptApiMultiturnStep3', { defaultValue: 'Next turns: send the same conversationId with new input.' })}</li>
                    <li>{t('promptApiMultiturnStep4', { defaultValue: 'Keep saveTrace=true to persist conversation history.' })}</li>
                  </ol>
                </div>
              )}
            </div>
          </div>
        </div>
        </div>
      </div>
    </div>
  );
}
