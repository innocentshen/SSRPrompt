import { useState, useEffect, useMemo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Users, Shield, Trash2, Search } from 'lucide-react';
import { Button, useToast } from '../ui';
import { usersApi, type UserListItem, type Role } from '../../api/users';
import { formatDate } from '../../lib/date-utils';

export function UserManagement() {
  const { t } = useTranslation('settings');
  const { t: tCommon } = useTranslation('common');
  const { showToast } = useToast();
  const [users, setUsers] = useState<UserListItem[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingUser, setEditingUser] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | UserListItem['status']>('all');

  const filteredUsers = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return users.filter((user) => {
      if (statusFilter !== 'all' && user.status !== statusFilter) return false;
      if (!normalizedQuery) return true;
      const haystack = [
        user.email,
        user.name,
        ...(user.roles || []),
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return haystack.includes(normalizedQuery);
    });
  }, [users, query, statusFilter]);

  const loadData = useCallback(async () => {
    try {
      const [usersData, rolesData] = await Promise.all([
        usersApi.list(),
        usersApi.getRoles(),
      ]);
      setUsers(usersData || []);
      setRoles(rolesData || []);
    } catch (err) {
      console.error('Failed to load users:', err);
      showToast('error', t('loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [showToast, t]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleStatusChange = async (userId: string, status: string) => {
    try {
      await usersApi.updateStatus(userId, status);
      setUsers((prev) =>
        prev.map((u) => (u.id === userId ? { ...u, status: status as UserListItem['status'] } : u))
      );
      showToast('success', t('userUpdated'));
    } catch {
      showToast('error', t('updateFailed'));
    }
  };

  const handleRoleChange = async (userId: string, roleName: string, checked: boolean) => {
    const user = users.find((u) => u.id === userId);
    if (!user) return;

    const newRoles = checked
      ? [...user.roles, roleName]
      : user.roles.filter((r) => r !== roleName);

    if (newRoles.length === 0) {
      showToast('error', t('atLeastOneRole'));
      return;
    }

    try {
      await usersApi.updateRoles(userId, newRoles);
      setUsers((prev) =>
        prev.map((u) => (u.id === userId ? { ...u, roles: newRoles } : u))
      );
      showToast('success', t('userUpdated'));
    } catch {
      showToast('error', t('updateFailed'));
    }
  };

  const handleDelete = async (userId: string) => {
    if (!confirm(t('deleteUserConfirm'))) return;

    try {
      await usersApi.delete(userId);
      setUsers((prev) => prev.filter((u) => u.id !== userId));
      showToast('success', t('userDeleted'));
    } catch {
      showToast('error', t('deleteFailed'));
    }
  };

  const statusColors = {
    active: 'bg-green-500/20 text-green-400',
    inactive: 'bg-slate-500/20 text-slate-400',
    suspended: 'bg-red-500/20 text-red-400',
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="w-8 h-8 border-2 border-cyan-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Users className="w-5 h-5 text-cyan-400" />
        <h2 className="text-lg font-semibold text-white light:text-slate-800">{t('userManagement')}</h2>
        <span className="text-sm text-slate-400 light:text-slate-500">({filteredUsers.length})</span>
        <div className="ml-auto flex items-center gap-2">
          <div className="relative w-52">
            <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500 light:text-slate-400" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('searchUsers')}
              aria-label={t('searchUsers')}
              className="w-full pl-7 pr-2 py-1.5 bg-slate-800 light:bg-slate-50 border border-slate-700 light:border-slate-300 rounded-md text-xs text-slate-200 light:text-slate-800 placeholder-slate-500 light:placeholder-slate-400 focus:outline-none focus:border-cyan-500"
            />
          </div>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}
            aria-label={t('status')}
            className="px-2 py-1.5 bg-slate-800 light:bg-slate-50 border border-slate-700 light:border-slate-300 rounded-md text-xs text-slate-200 light:text-slate-800 focus:outline-none focus:border-cyan-500"
          >
            <option value="all">{tCommon('all')}</option>
            <option value="active">{t('statusActive')}</option>
            <option value="inactive">{t('statusInactive')}</option>
            <option value="suspended">{t('statusSuspended')}</option>
          </select>
        </div>
      </div>

      <div className="bg-slate-800/50 light:bg-white rounded-xl border border-slate-700 light:border-slate-200 overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="border-b border-slate-700 light:border-slate-200">
              <th className="text-left px-4 py-3 text-sm font-medium text-slate-400 light:text-slate-600">{t('email')}</th>
              <th className="text-left px-4 py-3 text-sm font-medium text-slate-400 light:text-slate-600">{t('roles')}</th>
              <th className="text-left px-4 py-3 text-sm font-medium text-slate-400 light:text-slate-600">{t('status')}</th>
              <th className="text-left px-4 py-3 text-sm font-medium text-slate-400 light:text-slate-600">{t('createdAt')}</th>
              <th className="text-right px-4 py-3 text-sm font-medium text-slate-400 light:text-slate-600">{t('actions')}</th>
            </tr>
          </thead>
          <tbody>
            {filteredUsers.map((user) => (
              <tr key={user.id} className="border-b border-slate-700/50 light:border-slate-100 hover:bg-slate-700/30 light:hover:bg-slate-50">
                <td className="px-4 py-3">
                  <div>
                    <p className="text-sm text-white light:text-slate-800">{user.email}</p>
                    {user.name && <p className="text-xs text-slate-400 light:text-slate-500">{user.name}</p>}
                  </div>
                </td>
                <td className="px-4 py-3">
                  {editingUser === user.id ? (
                    <div className="flex flex-wrap gap-2">
                      {roles.map((role) => (
                        <label key={role.id} className="flex items-center gap-1 text-xs">
                          <input
                            type="checkbox"
                            checked={user.roles.includes(role.name)}
                            onChange={(e) => handleRoleChange(user.id, role.name, e.target.checked)}
                            className="w-3 h-3 rounded"
                          />
                          <span className="text-slate-300 light:text-slate-600">{role.name}</span>
                        </label>
                      ))}
                      <button
                        onClick={() => setEditingUser(null)}
                        className="text-xs text-cyan-400 hover:underline ml-2"
                      >
                        {t('done')}
                      </button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2">
                      {user.roles.map((role) => (
                        <span
                          key={role}
                          className={`px-2 py-0.5 text-xs rounded-full ${
                            role === 'admin' ? 'bg-purple-500/20 text-purple-400 light:bg-purple-100 light:text-purple-600' : 'bg-slate-600/50 text-slate-300 light:bg-slate-200 light:text-slate-600'
                          }`}
                        >
                          {role}
                        </span>
                      ))}
                      <button
                        onClick={() => setEditingUser(user.id)}
                        className="p-1 hover:bg-slate-600 light:hover:bg-slate-200 rounded"
                        title={t('editRoles')}
                      >
                        <Shield className="w-3 h-3 text-slate-400" />
                      </button>
                    </div>
                  )}
                </td>
                <td className="px-4 py-3">
                  <select
                    value={user.status}
                    onChange={(e) => handleStatusChange(user.id, e.target.value)}
                    className={`px-2 py-1 text-xs rounded-full border-0 cursor-pointer ${statusColors[user.status]}`}
                  >
                    <option value="active">{t('statusActive')}</option>
                    <option value="inactive">{t('statusInactive')}</option>
                    <option value="suspended">{t('statusSuspended')}</option>
                  </select>
                </td>
                <td className="px-4 py-3 text-sm text-slate-400 light:text-slate-600">
                  {formatDate(user.createdAt)}
                </td>
                <td className="px-4 py-3 text-right">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleDelete(user.id)}
                    className="text-red-400 hover:text-red-300 hover:bg-red-500/10"
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
