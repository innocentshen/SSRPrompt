import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Ban, BookOpenText, Check, Copy, KeyRound } from 'lucide-react';
import { promptApiKeysApi } from '../../api';
import { getErrorMessage } from '../../lib/error-messages';
import { formatDateTime } from '../../lib/date-utils';
import type { PromptApiKey } from '../../types';
import { Button, Input, useToast } from '../ui';

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
    defaultDesc: 'Reuse same id across turns for multi-turn context.',
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
    defaultDesc: 'Conversation id to use for next turn.',
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

export function PromptApiKeysManager() {
  const { t } = useTranslation('settings');
  const { showToast } = useToast();
  const [keys, setKeys] = useState<PromptApiKey[]>([]);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [expiresAtInput, setExpiresAtInput] = useState('');
  const [createdApiKey, setCreatedApiKey] = useState<string | null>(null);
  const [copiedCreatedKey, setCopiedCreatedKey] = useState(false);
  const [copiedInvokeUrl, setCopiedInvokeUrl] = useState(false);
  const [activeSpecTab, setActiveSpecTab] = useState<SpecTab>('overview');

  const invokeUrl = useMemo(() => `${API_BASE_URL}/open/prompts/{promptId}/invoke`, []);
  const invokeUrlExample = useMemo(() => invokeUrl.replace('{promptId}', '<prompt_id>'), [invokeUrl]);

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
      showToast('success', t('copied', { defaultValue: 'Copied' }));
    } catch {
      showToast('error', t('copyFailed', { defaultValue: 'Copy failed' }));
    }
  };

  const handleCopyInvokeUrl = async () => {
    try {
      await navigator.clipboard.writeText(invokeUrl);
      setCopiedInvokeUrl(true);
      showToast('success', t('copied', { defaultValue: 'Copied' }));
      setTimeout(() => setCopiedInvokeUrl(false), 1500);
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
      <div className="w-full h-full p-6 flex flex-col gap-6 overflow-hidden">
        <div className="w-full flex-shrink-0 grid grid-cols-1 xl:grid-cols-2 gap-4 sticky top-0 z-10 bg-slate-950/90 light:bg-slate-50/90 backdrop-blur-sm pb-2">
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
                label={t('name', { defaultValue: 'Name' })}
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
                {t('create', { defaultValue: 'Create' })}
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

        <div className="w-full flex-1 min-h-0 grid grid-cols-1 xl:grid-cols-3 gap-4">
          <div className="rounded-xl border border-slate-700 light:border-slate-200 bg-slate-900/40 light:bg-white p-4 flex flex-col gap-3 min-h-0 xl:col-span-1">
            <h4 className="text-lg font-medium text-slate-100 light:text-slate-900">{t('apiKeyList', { defaultValue: 'API Keys' })}</h4>

            {loading ? (
              <p className="text-sm text-slate-400 light:text-slate-600">{t('loading', { defaultValue: 'Loading...' })}</p>
            ) : keys.length === 0 ? (
              <p className="text-sm text-slate-400 light:text-slate-600">{t('empty', { defaultValue: 'No data' })}</p>
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

          <div className="rounded-xl border border-slate-700 light:border-slate-200 bg-slate-900/40 light:bg-white p-4 flex flex-col gap-4 min-h-0 xl:col-span-2">
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
                    <p className="text-sm font-medium text-slate-200 light:text-slate-800 mb-2">{t('promptApiSectionCurl', { defaultValue: 'cURL (stream=false)' })}</p>
                    <pre className="rounded-md bg-slate-950 light:bg-slate-100 border border-slate-800 light:border-slate-200 px-3 py-2 text-[11px] text-slate-300 light:text-slate-700 overflow-auto">{curlExample}</pre>
                  </div>
                  <div>
                    <p className="text-sm font-medium text-slate-200 light:text-slate-800 mb-2">{t('promptApiSectionCurlSse', { defaultValue: 'cURL (stream=true / SSE)' })}</p>
                    <pre className="rounded-md bg-slate-950 light:bg-slate-100 border border-slate-800 light:border-slate-200 px-3 py-2 text-[11px] text-slate-300 light:text-slate-700 overflow-auto">{sseExample}</pre>
                  </div>
                </div>
              )}

              {activeSpecTab === 'multiturn' && (
                <div className="rounded-lg border border-slate-700 light:border-slate-200 bg-slate-900/40 light:bg-slate-50 p-3">
                  <p className="text-sm text-slate-300 light:text-slate-700 font-medium mb-2">{t('promptApiSectionMultiturn', { defaultValue: 'Multi-turn Workflow' })}</p>
                  <ol className="list-decimal list-inside text-sm text-slate-400 light:text-slate-600 space-y-1">
                    <li>{t('promptApiMultiturnStep1', { defaultValue: 'First turn: send input only.' })}</li>
                    <li>{t('promptApiMultiturnStep2', { defaultValue: 'Read X-Conversation-Id from response headers.' })}</li>
                    <li>{t('promptApiMultiturnStep3', { defaultValue: 'Next turns: send same conversationId with new input.' })}</li>
                    <li>{t('promptApiMultiturnStep4', { defaultValue: 'Keep saveTrace=true to persist conversation history.' })}</li>
                  </ol>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
