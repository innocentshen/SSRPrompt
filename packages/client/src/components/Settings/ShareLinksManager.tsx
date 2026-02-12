import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  Check,
  CheckSquare,
  Copy,
  Eye,
  ExternalLink,
  Link2Off,
  Loader2,
  Settings2,
  Square,
} from 'lucide-react';
import { Button, Input, Modal, Select, useToast } from '../ui';
import { shareApi } from '../../api';
import type { ShareAccessLogPage, ShareLink } from '../../types';
import { formatDateTime } from '../../lib/date-utils';
import { getErrorMessage } from '../../lib/error-messages';
import { isoToLocalInputValue, localInputValueToIso } from '../../lib/datetime-local';

type ResourceFilter = 'all' | 'prompt' | 'evaluation';

type ConfirmAction =
  | { type: 'single-revoke'; link: ShareLink }
  | { type: 'batch-revoke'; ids: string[] };

function getShareUrl(link: ShareLink): string {
  const path = link.resourceType === 'prompt' ? '/share/p/' : '/share/e/';
  return `${window.location.origin}${path}${link.token}`;
}

function getResourceUrl(link: ShareLink): string {
  if (link.resourceType === 'prompt') {
    return `/prompts?promptId=${encodeURIComponent(link.resourceId)}`;
  }
  return `/evaluation?evaluationId=${encodeURIComponent(link.resourceId)}`;
}

export function ShareLinksManager() {
  const navigate = useNavigate();
  const { showToast } = useToast();
  const { t } = useTranslation('settings');
  const { t: tCommon } = useTranslation('common');
  const [loading, setLoading] = useState(false);
  const [links, setLinks] = useState<ShareLink[]>([]);
  const [resourceFilter, setResourceFilter] = useState<ResourceFilter>('all');
  const [includeRevoked, setIncludeRevoked] = useState(false);
  const [editingLink, setEditingLink] = useState<ShareLink | null>(null);
  const [saving, setSaving] = useState(false);
  const [expiresAtInput, setExpiresAtInput] = useState('');
  const [allowCopy, setAllowCopy] = useState(true);
  const [password, setPassword] = useState('');
  const [clearPassword, setClearPassword] = useState(false);
  const [logsByLinkId, setLogsByLinkId] = useState<Record<string, ShareAccessLogPage>>({});
  const [loadingLogLinkId, setLoadingLogLinkId] = useState<string | null>(null);
  const [visibleLogLinkId, setVisibleLogLinkId] = useState<string | null>(null);
  const [selectedLinkIds, setSelectedLinkIds] = useState<Set<string>>(new Set());
  const [confirmAction, setConfirmAction] = useState<ConfirmAction | null>(null);
  const [revoking, setRevoking] = useState(false);

  const selectAllRef = useRef<HTMLInputElement | null>(null);

  const loadLinks = useCallback(async () => {
    setLoading(true);
    try {
      const result = await shareApi.listLinks({
        resourceType: resourceFilter === 'all' ? undefined : resourceFilter,
        includeRevoked,
        page: 1,
        pageSize: 100,
      });
      setLinks(result.data);
    } catch (error) {
      showToast('error', getErrorMessage(error));
    } finally {
      setLoading(false);
    }
  }, [includeRevoked, resourceFilter, showToast]);

  const sortedLinks = useMemo(
    () =>
      [...links].sort(
        (left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime()
      ),
    [links]
  );

  const totalCount = sortedLinks.length;
  const revokedCount = useMemo(
    () => sortedLinks.filter((link) => Boolean(link.revokedAt)).length,
    [sortedLinks]
  );
  const activeCount = totalCount - revokedCount;
  const withPasswordCount = useMemo(
    () => sortedLinks.filter((link) => link.hasPassword).length,
    [sortedLinks]
  );

  useEffect(() => {
    void loadLinks();
  }, [loadLinks]);

  useEffect(() => {
    const visibleIds = new Set(sortedLinks.map((link) => link.id));
    setSelectedLinkIds((prev) => {
      const next = new Set<string>();
      for (const id of prev) {
        if (visibleIds.has(id)) next.add(id);
      }
      return next;
    });
  }, [sortedLinks]);

  const allVisibleSelected = sortedLinks.length > 0 && sortedLinks.every((link) => selectedLinkIds.has(link.id));
  const someVisibleSelected = sortedLinks.some((link) => selectedLinkIds.has(link.id)) && !allVisibleSelected;

  useEffect(() => {
    if (!selectAllRef.current) return;
    selectAllRef.current.indeterminate = someVisibleSelected;
  }, [someVisibleSelected]);

  const selectedLinks = useMemo(
    () => sortedLinks.filter((link) => selectedLinkIds.has(link.id)),
    [selectedLinkIds, sortedLinks]
  );
  const selectedCount = selectedLinks.length;
  const selectedActiveLinks = useMemo(
    () => selectedLinks.filter((link) => !link.revokedAt),
    [selectedLinks]
  );

  const openEditModal = (link: ShareLink) => {
    setEditingLink(link);
    setExpiresAtInput(isoToLocalInputValue(link.expiresAt));
    setAllowCopy(link.allowCopy);
    setPassword('');
    setClearPassword(false);
  };

  const closeEditModal = () => {
    setEditingLink(null);
    setPassword('');
    setClearPassword(false);
  };

  const handleSaveLink = async () => {
    if (!editingLink) return;
    setSaving(true);
    try {
      await shareApi.updateLink(editingLink.id, {
        allowCopy,
        expiresAt: localInputValueToIso(expiresAtInput),
        ...(clearPassword ? { clearPassword: true } : {}),
        ...(password.trim() ? { password: password.trim() } : {}),
      });
      showToast('success', t('shareMgmtSaveSuccess'));
      closeEditModal();
      await loadLinks();
    } catch (error) {
      showToast('error', getErrorMessage(error));
    } finally {
      setSaving(false);
    }
  };

  const handleCopyLink = async (link: ShareLink) => {
    try {
      await navigator.clipboard.writeText(getShareUrl(link));
      showToast('success', t('shareMgmtCopySuccess'));
    } catch {
      showToast('error', t('shareMgmtCopyFailed'));
    }
  };

  const handleCopySelectedLinks = async () => {
    if (selectedLinks.length === 0) return;
    try {
      await navigator.clipboard.writeText(selectedLinks.map((link) => getShareUrl(link)).join('\n'));
      showToast('success', t('shareMgmtBulkCopySuccess', { count: selectedLinks.length }));
    } catch {
      showToast('error', t('shareMgmtCopyFailed'));
    }
  };

  const toggleLogs = async (link: ShareLink) => {
    if (visibleLogLinkId === link.id) {
      setVisibleLogLinkId(null);
      return;
    }

    setVisibleLogLinkId(link.id);
    if (logsByLinkId[link.id]) return;

    setLoadingLogLinkId(link.id);
    try {
      const logs = await shareApi.listAccessLogs(link.id, { page: 1, limit: 20 });
      setLogsByLinkId((prev) => ({ ...prev, [link.id]: logs }));
    } catch (error) {
      showToast('error', getErrorMessage(error));
    } finally {
      setLoadingLogLinkId(null);
    }
  };

  const handleNavigateToResource = (link: ShareLink) => {
    if (!link.resourceName) {
      showToast('info', t('shareMgmtResourceUnavailable'));
      return;
    }
    navigate(getResourceUrl(link));
  };

  const toggleSelectLink = (linkId: string) => {
    setSelectedLinkIds((prev) => {
      const next = new Set(prev);
      if (next.has(linkId)) {
        next.delete(linkId);
      } else {
        next.add(linkId);
      }
      return next;
    });
  };

  const handleSelectAllVisible = (checked: boolean) => {
    if (!checked) {
      setSelectedLinkIds((prev) => {
        const next = new Set(prev);
        for (const link of sortedLinks) next.delete(link.id);
        return next;
      });
      return;
    }

    setSelectedLinkIds((prev) => {
      const next = new Set(prev);
      for (const link of sortedLinks) next.add(link.id);
      return next;
    });
  };

  const closeConfirmModal = () => {
    if (revoking) return;
    setConfirmAction(null);
  };

  const openSingleRevokeConfirm = (link: ShareLink) => {
    setConfirmAction({ type: 'single-revoke', link });
  };

  const openBatchRevokeConfirm = () => {
    if (selectedActiveLinks.length === 0) return;
    setConfirmAction({ type: 'batch-revoke', ids: selectedActiveLinks.map((link) => link.id) });
  };

  const handleConfirmRevoke = async () => {
    if (!confirmAction) return;
    setRevoking(true);
    try {
      if (confirmAction.type === 'single-revoke') {
        await shareApi.revokeLink(confirmAction.link.id);
        showToast('success', t('shareMgmtRevokeSuccess'));
      } else {
        const targetIds = new Set(confirmAction.ids);
        const targets = sortedLinks.filter((link) => targetIds.has(link.id) && !link.revokedAt);
        if (targets.length > 0) {
          const results = await Promise.allSettled(
            targets.map(async (link) => {
              await shareApi.revokeLink(link.id);
              return link.id;
            })
          );
          const successCount = results.filter((result) => result.status === 'fulfilled').length;
          const failedCount = results.length - successCount;
          if (failedCount === 0) {
            showToast('success', t('shareMgmtBulkRevokeSuccess', { count: successCount }));
          } else {
            showToast(
              successCount > 0 ? 'info' : 'error',
              t('shareMgmtBulkRevokePartial', { success: successCount, failed: failedCount })
            );
          }
        }
      }

      setSelectedLinkIds(new Set());
      setConfirmAction(null);
      await loadLinks();
    } catch (error) {
      showToast('error', getErrorMessage(error));
    } finally {
      setRevoking(false);
    }
  };

  const confirmTitle =
    confirmAction?.type === 'batch-revoke'
      ? t('shareMgmtConfirmBatchTitle')
      : t('shareMgmtConfirmSingleTitle');

  const confirmBody =
    confirmAction?.type === 'batch-revoke'
      ? t('shareMgmtConfirmBatchBody', { count: confirmAction.ids.length })
      : t('shareMgmtConfirmSingleBody');

  return (
    <div className="space-y-4 w-full">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="rounded-lg border border-slate-700/70 light:border-slate-200 bg-slate-900/50 light:bg-white px-3 py-2">
          <p className="text-xs text-slate-500 light:text-slate-600">{t('shareMgmtStatsTotal')}</p>
          <p className="mt-1 text-base font-semibold text-slate-100 light:text-slate-900">{totalCount}</p>
        </div>
        <div className="rounded-lg border border-slate-700/70 light:border-slate-200 bg-slate-900/50 light:bg-white px-3 py-2">
          <p className="text-xs text-slate-500 light:text-slate-600">{t('shareMgmtStatsActive')}</p>
          <p className="mt-1 text-base font-semibold text-emerald-400 light:text-emerald-600">{activeCount}</p>
        </div>
        <div className="rounded-lg border border-slate-700/70 light:border-slate-200 bg-slate-900/50 light:bg-white px-3 py-2">
          <p className="text-xs text-slate-500 light:text-slate-600">{t('shareMgmtStatsRevoked')}</p>
          <p className="mt-1 text-base font-semibold text-rose-400 light:text-rose-600">{revokedCount}</p>
        </div>
        <div className="rounded-lg border border-slate-700/70 light:border-slate-200 bg-slate-900/50 light:bg-white px-3 py-2">
          <p className="text-xs text-slate-500 light:text-slate-600">{t('shareMgmtStatsWithPassword')}</p>
          <p className="mt-1 text-base font-semibold text-amber-400 light:text-amber-600">{withPasswordCount}</p>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 flex-wrap">
          <Select
            value={resourceFilter}
            onChange={(event) => setResourceFilter(event.target.value as ResourceFilter)}
            options={[
              { value: 'all', label: t('shareMgmtFilterAll') },
              { value: 'prompt', label: t('shareMgmtFilterPrompt') },
              { value: 'evaluation', label: t('shareMgmtFilterEvaluation') },
            ]}
          />
          <label className="inline-flex items-center gap-2 text-sm text-slate-300 light:text-slate-700">
            <input
              type="checkbox"
              checked={includeRevoked}
              onChange={(event) => setIncludeRevoked(event.target.checked)}
              className="w-4 h-4 rounded border-slate-600 bg-slate-700 text-cyan-500 focus:ring-cyan-500 focus:ring-offset-slate-900"
            />
            {t('shareMgmtIncludeRevoked')}
          </label>
        </div>
        <Button variant="secondary" onClick={() => void loadLinks()} loading={loading}>
          {tCommon('refresh')}
        </Button>
      </div>

      <div className="rounded-lg border border-slate-700/70 light:border-slate-200 bg-slate-900/40 light:bg-white px-3 py-2 flex flex-wrap items-center justify-between gap-3">
        <label className="inline-flex items-center gap-2 text-sm text-slate-200 light:text-slate-800">
          <input
            ref={selectAllRef}
            type="checkbox"
            checked={allVisibleSelected}
            onChange={(event) => handleSelectAllVisible(event.target.checked)}
            className="w-4 h-4 rounded border-slate-600 bg-slate-700 text-cyan-500 focus:ring-cyan-500 focus:ring-offset-slate-900"
          />
          {t('shareMgmtSelectAll')}
        </label>

        <div className="inline-flex items-center gap-2 text-sm text-slate-300 light:text-slate-700">
          {allVisibleSelected ? <CheckSquare className="w-4 h-4 text-cyan-400" /> : <Square className="w-4 h-4" />}
          <span>{t('shareMgmtBulkSelected', { count: selectedCount })}</span>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => void handleCopySelectedLinks()}
            disabled={selectedCount === 0}
          >
            <Copy className="w-4 h-4" />
            <span>{t('shareMgmtBulkCopy')}</span>
          </Button>
          <Button
            variant="danger"
            size="sm"
            onClick={openBatchRevokeConfirm}
            disabled={selectedActiveLinks.length === 0}
          >
            <Link2Off className="w-4 h-4" />
            <span>{t('shareMgmtBulkRevoke')}</span>
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setSelectedLinkIds(new Set())}
            disabled={selectedCount === 0}
          >
            {t('shareMgmtClearSelection')}
          </Button>
        </div>
      </div>

      <div className="border border-slate-700 light:border-slate-200 rounded-xl overflow-hidden">
        {sortedLinks.length === 0 ? (
          <div className="p-6 text-sm text-slate-400 light:text-slate-600">{t('shareMgmtEmpty')}</div>
        ) : (
          <div className="divide-y divide-slate-700/70 light:divide-slate-200">
            {sortedLinks.map((link) => (
              <div key={link.id} className="p-4 bg-slate-900/50 light:bg-white">
                <div className="flex items-start gap-3">
                  <input
                    type="checkbox"
                    checked={selectedLinkIds.has(link.id)}
                    onChange={() => toggleSelectLink(link.id)}
                    className="mt-1 w-4 h-4 rounded border-slate-600 bg-slate-700 text-cyan-500 focus:ring-cyan-500 focus:ring-offset-slate-900"
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-4">
                      <div className="space-y-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-medium text-slate-200 light:text-slate-800 truncate">
                            {link.resourceName || t('shareMgmtResourceDeleted')}
                          </span>
                          <span className="px-2 py-0.5 rounded-full text-xs bg-slate-700 text-slate-200 light:bg-slate-200 light:text-slate-700">
                            {link.resourceType === 'prompt' ? t('shareMgmtFilterPrompt') : t('shareMgmtFilterEvaluation')}
                          </span>
                          {link.revokedAt ? (
                            <span className="px-2 py-0.5 rounded-full text-xs bg-rose-500/20 text-rose-300">
                              {t('shareMgmtStatusRevoked')}
                            </span>
                          ) : (
                            <span className="px-2 py-0.5 rounded-full text-xs bg-emerald-500/20 text-emerald-300">
                              {t('shareMgmtStatusActive')}
                            </span>
                          )}
                          {link.hasPassword && (
                            <span className="px-2 py-0.5 rounded-full text-xs bg-amber-500/20 text-amber-300">
                              {t('shareMgmtStatsWithPassword')}
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-slate-500 light:text-slate-600 flex flex-wrap gap-3">
                          <span>{t('createdAt')}: {formatDateTime(link.createdAt)}</span>
                          <span>
                            {t('shareMgmtExpiresAt')}:{' '}
                            {link.expiresAt ? formatDateTime(link.expiresAt) : t('shareMgmtExpiresNever')}
                          </span>
                          <span>{t('shareMgmtAccessCount')}: {link.accessCount}</span>
                          <span>
                            {t('shareMgmtLastAccess')}:{' '}
                            {link.lastAccessedAt ? formatDateTime(link.lastAccessedAt) : t('shareMgmtNoAccess')}
                          </span>
                        </div>
                        <p className="text-xs text-slate-500 light:text-slate-600 break-all">{getShareUrl(link)}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        <Button
                          variant="ghost"
                          size="sm"
                          title={t('shareMgmtOpenResource')}
                          onClick={() => handleNavigateToResource(link)}
                          disabled={!link.resourceName}
                        >
                          <ExternalLink className="w-4 h-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          title={t('shareMgmtCopyLink')}
                          onClick={() => void handleCopyLink(link)}
                        >
                          <Copy className="w-4 h-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          title={visibleLogLinkId === link.id ? t('shareMgmtHideLogs') : t('shareMgmtViewLogs')}
                          onClick={() => void toggleLogs(link)}
                        >
                          <Eye className="w-4 h-4" />
                        </Button>
                        {!link.revokedAt && (
                          <>
                            <Button
                              variant="ghost"
                              size="sm"
                              title={t('shareMgmtEdit')}
                              onClick={() => openEditModal(link)}
                            >
                              <Settings2 className="w-4 h-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              title={t('shareMgmtRevoke')}
                              onClick={() => openSingleRevokeConfirm(link)}
                            >
                              <Link2Off className="w-4 h-4 text-rose-400" />
                            </Button>
                          </>
                        )}
                      </div>
                    </div>

                    {visibleLogLinkId === link.id && (
                      <div className="mt-3 pt-3 border-t border-slate-700/60 light:border-slate-200">
                        {loadingLogLinkId === link.id ? (
                          <div className="text-sm text-slate-400 inline-flex items-center gap-2">
                            <Loader2 className="w-4 h-4 animate-spin" />
                            {t('shareMgmtLoadingLogs')}
                          </div>
                        ) : (
                          <div className="space-y-2">
                            {(logsByLinkId[link.id]?.data || []).length === 0 ? (
                              <p className="text-sm text-slate-500 light:text-slate-600">{t('shareMgmtNoLogs')}</p>
                            ) : (
                              (logsByLinkId[link.id]?.data || []).map((log) => (
                                <div
                                  key={log.id}
                                  className="text-xs text-slate-400 light:text-slate-600 flex flex-wrap gap-3"
                                >
                                  <span>{formatDateTime(log.createdAt)}</span>
                                  <span>{log.action}</span>
                                  <span>{log.accessorUserId || '-'}</span>
                                  <span>{log.ipAddress || '-'}</span>
                                </div>
                              ))
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <Modal isOpen={editingLink !== null} onClose={closeEditModal} title={t('shareMgmtEditTitle')} size="md">
        {editingLink && (
          <div className="space-y-4">
            <Input
              label={t('shareMgmtExpiresAt')}
              type="datetime-local"
              value={expiresAtInput}
              onChange={(event) => setExpiresAtInput(event.target.value)}
            />

            <label className="flex items-center gap-2 text-sm text-slate-300 light:text-slate-700">
              <input
                type="checkbox"
                checked={allowCopy}
                onChange={(event) => setAllowCopy(event.target.checked)}
                className="w-4 h-4 rounded border-slate-600 bg-slate-700 text-cyan-500 focus:ring-cyan-500 focus:ring-offset-slate-900"
              />
              {t('shareMgmtAllowCopy')}
            </label>

            <Input
              label={t('shareMgmtPasswordLabel')}
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder={t('shareMgmtPasswordPlaceholder')}
            />

            <label className="flex items-center gap-2 text-sm text-slate-300 light:text-slate-700">
              <input
                type="checkbox"
                checked={clearPassword}
                onChange={(event) => setClearPassword(event.target.checked)}
                className="w-4 h-4 rounded border-slate-600 bg-slate-700 text-cyan-500 focus:ring-cyan-500 focus:ring-offset-slate-900"
              />
              {t('shareMgmtClearPassword')}
            </label>

            <div className="flex justify-end gap-2 pt-2">
              <Button variant="secondary" onClick={closeEditModal}>
                {tCommon('cancel')}
              </Button>
              <Button onClick={() => void handleSaveLink()} loading={saving}>
                <Check className="w-4 h-4" />
                {tCommon('save')}
              </Button>
            </div>
          </div>
        )}
      </Modal>

      <Modal isOpen={confirmAction !== null} onClose={closeConfirmModal} title={confirmTitle} size="sm">
        <div className="space-y-4">
          <p className="text-sm text-slate-300 light:text-slate-700">{confirmBody}</p>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={closeConfirmModal} disabled={revoking}>
              {tCommon('cancel')}
            </Button>
            <Button variant="danger" onClick={() => void handleConfirmRevoke()} loading={revoking}>
              <Link2Off className="w-4 h-4" />
              {t('shareMgmtConfirmRevoke')}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
