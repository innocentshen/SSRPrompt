import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Copy, Download, KeyRound, Link2, Lock } from 'lucide-react';
import { Badge, Button, Input, useToast } from '../components/ui';
import { ApiError, shareApi } from '../api';
import type { FileAttachment } from '../types';
import type { ShareEvaluationDetail } from '../types';
import { formatDateTime } from '../lib/date-utils';
import { getErrorMessage } from '../lib/error-messages';

type ViewState = 'loading' | 'ready' | 'password' | 'error';

function getCaseAttachments(testCase: { attachments?: unknown[] | null }): FileAttachment[] {
  const raw = testCase.attachments;
  if (!Array.isArray(raw)) return [];
  return raw as FileAttachment[];
}

export function ShareEvaluationPage() {
  const { token = '' } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const { showToast } = useToast();
  const [viewState, setViewState] = useState<ViewState>('loading');
  const [detail, setDetail] = useState<ShareEvaluationDetail | null>(null);
  const [errorText, setErrorText] = useState('');
  const [password, setPassword] = useState('');
  const [verifying, setVerifying] = useState(false);
  const [copying, setCopying] = useState(false);
  const [downloadingFileId, setDownloadingFileId] = useState<string | null>(null);

  const loadDetail = useCallback(async () => {
    if (!token) {
      setViewState('error');
      setErrorText('分享链接无效');
      return;
    }

    setViewState('loading');
    try {
      const data = await shareApi.getSharedEvaluation(token);
      setDetail(data);
      setViewState('ready');
    } catch (error) {
      if (error instanceof ApiError && error.code === 'SHARE_PASSWORD_REQUIRED') {
        setViewState('password');
        return;
      }
      setViewState('error');
      setErrorText(getErrorMessage(error));
    }
  }, [token]);

  useEffect(() => {
    void loadDetail();
  }, [loadDetail]);

  const evaluationConfigJson = useMemo(() => {
    if (!detail) return '';
    try {
      return JSON.stringify(detail.evaluation.config ?? {}, null, 2);
    } catch {
      return '{}';
    }
  }, [detail]);

  const handleVerifyPassword = async () => {
    if (!token || !password.trim()) return;
    setVerifying(true);
    try {
      await shareApi.verifyPassword(token, password.trim());
      showToast('success', '密码验证成功');
      setPassword('');
      await loadDetail();
    } catch (error) {
      showToast('error', getErrorMessage(error));
    } finally {
      setVerifying(false);
    }
  };

  const handleCopy = async () => {
    if (!token) return;
    setCopying(true);
    try {
      await shareApi.copySharedEvaluation(token);
      showToast('success', '已复制到你的评测集');
      navigate('/evaluation');
    } catch (error) {
      showToast('error', getErrorMessage(error));
    } finally {
      setCopying(false);
    }
  };

  const handleDownloadAttachment = async (fileId: string, fileName: string) => {
    if (!token) return;
    setDownloadingFileId(fileId);
    try {
      const blob = await shareApi.downloadSharedEvaluationAttachmentBlob(token, fileId);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = fileName;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    } catch (error) {
      showToast('error', getErrorMessage(error));
    } finally {
      setDownloadingFileId(null);
    }
  };

  if (viewState === 'loading') {
    return (
      <div className="min-h-screen bg-slate-950 light:bg-slate-50 flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-cyan-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (viewState === 'password') {
    return (
      <div className="min-h-screen bg-slate-950 light:bg-slate-50 p-4 flex items-center justify-center">
        <div className="w-full max-w-md border border-slate-700 light:border-slate-200 rounded-xl bg-slate-900 light:bg-white p-6">
          <div className="flex items-center gap-2 mb-4">
            <Lock className="w-5 h-5 text-amber-400" />
            <h1 className="text-lg font-semibold text-white light:text-slate-900">此分享需要访问密码</h1>
          </div>
          <Input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="请输入分享密码"
            onKeyDown={(e) => {
              if (e.key === 'Enter') void handleVerifyPassword();
            }}
          />
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="secondary" onClick={() => navigate('/evaluation')}>
              返回
            </Button>
            <Button onClick={() => void handleVerifyPassword()} loading={verifying}>
              <KeyRound className="w-4 h-4" />
              验证
            </Button>
          </div>
        </div>
      </div>
    );
  }

  if (viewState === 'error' || !detail) {
    return (
      <div className="min-h-screen bg-slate-950 light:bg-slate-50 flex items-center justify-center p-4">
        <div className="w-full max-w-lg border border-slate-700 light:border-slate-200 rounded-xl bg-slate-900 light:bg-white p-6">
          <h1 className="text-lg font-semibold text-white light:text-slate-900">分享不可用</h1>
          <p className="text-sm text-slate-400 light:text-slate-600 mt-2">{errorText || '分享链接已失效'}</p>
          <div className="mt-4">
            <Button variant="secondary" onClick={() => navigate('/evaluation')}>
              返回
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 light:bg-slate-50">
      <div className="max-w-6xl mx-auto p-4 md:p-6 space-y-4">
        <div className="flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={() => navigate(-1)}
            className="inline-flex items-center gap-1 text-sm text-slate-400 light:text-slate-600 hover:text-slate-100 light:hover:text-slate-900"
          >
            <ArrowLeft className="w-4 h-4" />
            返回
          </button>
          <Button onClick={() => void handleCopy()} disabled={!detail.canCopy} loading={copying}>
            <Copy className="w-4 h-4" />
            一键复制到我的评测集
          </Button>
        </div>

        <div className="border border-slate-700 light:border-slate-200 rounded-xl bg-slate-900 light:bg-white p-4 md:p-5">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-semibold text-white light:text-slate-900">{detail.evaluation.name}</h1>
            <Badge variant="info">{detail.evaluation.status}</Badge>
            {detail.shareLink.expiresAt && (
              <Badge variant="warning">过期时间：{formatDateTime(detail.shareLink.expiresAt)}</Badge>
            )}
          </div>
          <div className="mt-3 text-xs text-slate-500 light:text-slate-600 flex flex-wrap gap-3">
            <span>创建时间：{formatDateTime(detail.evaluation.createdAt)}</span>
            <span className="inline-flex items-center gap-1">
              <Link2 className="w-3 h-3" />
              链接访问次数：{detail.shareLink.accessCount}
            </span>
          </div>
        </div>

        <div className="border border-slate-700 light:border-slate-200 rounded-xl bg-slate-900 light:bg-white p-4">
          <h2 className="text-sm font-medium text-slate-200 light:text-slate-800 mb-3">评测配置</h2>
          <pre className="text-xs whitespace-pre-wrap text-slate-300 light:text-slate-700 font-mono">
            {evaluationConfigJson}
          </pre>
        </div>

        <div className="border border-slate-700 light:border-slate-200 rounded-xl bg-slate-900 light:bg-white p-4">
          <h2 className="text-sm font-medium text-slate-200 light:text-slate-800 mb-3">
            测试用例（{detail.evaluation.testCases.length}）
          </h2>
          <div className="space-y-3">
            {detail.evaluation.testCases.map((testCase) => {
              const attachments = getCaseAttachments(testCase);
              return (
                <div
                  key={testCase.id}
                  className="p-3 rounded-lg border border-slate-700/60 light:border-slate-200 bg-slate-800/50 light:bg-slate-50"
                >
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm text-slate-200 light:text-slate-800 font-medium">
                      {testCase.name || '未命名用例'}
                    </p>
                    {attachments.length > 0 && (
                      <Badge variant="info">附件 {attachments.length}</Badge>
                    )}
                  </div>
                  {testCase.inputText && (
                    <p className="text-xs text-slate-300 light:text-slate-700 mt-2 whitespace-pre-wrap">
                      {testCase.inputText}
                    </p>
                  )}
                  {attachments.length > 0 && (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {attachments.map((attachment) => (
                        <Button
                          key={attachment.fileId}
                          variant="secondary"
                          size="sm"
                          onClick={() => void handleDownloadAttachment(attachment.fileId, attachment.name)}
                          disabled={downloadingFileId === attachment.fileId}
                        >
                          <Download className="w-3.5 h-3.5" />
                          <span className="max-w-[220px] truncate">{attachment.name}</span>
                        </Button>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        <div className="border border-slate-700 light:border-slate-200 rounded-xl bg-slate-900 light:bg-white p-4">
          <h2 className="text-sm font-medium text-slate-200 light:text-slate-800 mb-3">
            评测标准（{detail.evaluation.criteria.length}）
          </h2>
          <div className="space-y-2">
            {detail.evaluation.criteria.map((criterion) => (
              <div
                key={criterion.id}
                className="p-3 rounded-lg border border-slate-700/60 light:border-slate-200 bg-slate-800/50 light:bg-slate-50"
              >
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm text-slate-200 light:text-slate-800">{criterion.name}</p>
                  <Badge variant={criterion.enabled ? 'success' : 'warning'}>
                    权重 {criterion.weight}
                  </Badge>
                </div>
                {criterion.description && (
                  <p className="text-xs text-slate-400 light:text-slate-600 mt-1">{criterion.description}</p>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export default ShareEvaluationPage;

