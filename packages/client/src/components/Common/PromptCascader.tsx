import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, ChevronDown, ChevronRight, FileText, Folder, Search, Unlink } from 'lucide-react';
import type { Prompt, PromptGroup } from '../../types';

type GroupTreeNode = PromptGroup & { depth: number; children: GroupTreeNode[] };

interface PromptCascaderProps {
  label?: string;
  error?: string;
  disabled?: boolean;
  value: string | null;
  onChange: (promptId: string | null) => void;
  prompts: Prompt[];
  groups: PromptGroup[];
  allowClear?: boolean;
  clearLabel?: string;
  placeholder?: string;
  className?: string;
}

export function PromptCascader({
  label,
  error,
  disabled = false,
  value,
  onChange,
  prompts,
  groups,
  allowClear = false,
  clearLabel,
  placeholder,
  className = '',
}: PromptCascaderProps) {
  const { t: tCommon } = useTranslation('common');
  const { t: tPrompts } = useTranslation('prompts');

  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [openDirection, setOpenDirection] = useState<'up' | 'down'>('down');
  const [activeGroupId, setActiveGroupId] = useState<string | null>(null);
  const [expandedGroupIds, setExpandedGroupIds] = useState<Record<string, boolean>>({});

  const containerRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const groupById = useMemo(() => new Map(groups.map((g) => [g.id, g])), [groups]);

  const buildGroupPath = useCallback((groupId: string | null): PromptGroup[] => {
    if (!groupId) return [];
    const path: PromptGroup[] = [];
    let current: string | null = groupId;
    const safety = new Set<string>();
    while (current) {
      if (safety.has(current)) break;
      safety.add(current);
      const group = groupById.get(current);
      if (!group) break;
      path.push(group);
      current = group.parentId ?? null;
    }
    return path.reverse();
  }, [groupById]);

  const getPromptPathLabel = useCallback((prompt: Prompt) => {
    const parts = prompt.groupId ? buildGroupPath(prompt.groupId).map((g) => g.name) : [tPrompts('ungrouped')];
    return [...parts, prompt.name].join(' / ');
  }, [buildGroupPath, tPrompts]);

  const selectedPrompt = useMemo(() => prompts.find((p) => p.id === value) ?? null, [prompts, value]);
  const displayLabel = selectedPrompt ? getPromptPathLabel(selectedPrompt) : placeholder || clearLabel || tPrompts('selectPrompt');

  const calculateDirection = () => {
    if (!containerRef.current) return 'down';
    const rect = containerRef.current.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom;
    const spaceAbove = rect.top;
    const dropdownHeight = 360;
    if (spaceBelow < dropdownHeight && spaceAbove > spaceBelow) return 'up';
    return 'down';
  };

  const toggleExpanded = (groupId: string) => {
    setExpandedGroupIds((prev) => ({ ...prev, [groupId]: !(prev[groupId] ?? true) }));
  };
  const isExpanded = (groupId: string) => expandedGroupIds[groupId] ?? true;

  const groupTree = useMemo<GroupTreeNode[]>(() => {
    const byParent = new Map<string | null, PromptGroup[]>();
    for (const g of groups) {
      const key = g.parentId ?? null;
      byParent.set(key, [...(byParent.get(key) ?? []), g]);
    }

    const sortGroups = (list: PromptGroup[]) =>
      [...list].sort((a, b) => {
        const orderDiff = (a.orderIndex || 0) - (b.orderIndex || 0);
        if (orderDiff !== 0) return orderDiff;
        return new Date(a.createdAt || 0).getTime() - new Date(b.createdAt || 0).getTime();
      });

    const build = (parentId: string | null, depth: number): GroupTreeNode[] => {
      if (depth > 3) return [];
      const children = sortGroups(byParent.get(parentId) ?? []);
      return children.map((g) => ({
        ...g,
        depth,
        children: build(g.id, depth + 1),
      }));
    };

    return build(null, 1);
  }, [groups]);

  const promptsByGroupId = useMemo(() => {
    const map = new Map<string | null, Prompt[]>();
    for (const p of prompts) {
      const key = p.groupId ?? null;
      map.set(key, [...(map.get(key) ?? []), p]);
    }
    return map;
  }, [prompts]);

  const filteredPrompts = useMemo(() => {
    if (!searchQuery.trim()) return [];
    const q = searchQuery.trim().toLowerCase();
    return prompts
      .filter((p) => {
        const nameMatch = p.name.toLowerCase().includes(q);
        if (nameMatch) return true;
        return getPromptPathLabel(p).toLowerCase().includes(q);
      })
      .sort((a, b) => getPromptPathLabel(a).localeCompare(getPromptPathLabel(b)));
  }, [prompts, searchQuery, getPromptPathLabel]);

  const openDropdown = () => {
    if (disabled) return;
    setOpenDirection(calculateDirection());
    setIsOpen(true);
    setSearchQuery('');
    setActiveGroupId(selectedPrompt?.groupId ?? null);
  };

  const closeDropdown = () => {
    setIsOpen(false);
    setSearchQuery('');
  };

  // Click outside to close
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        closeDropdown();
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Focus search input when opened
  useEffect(() => {
    if (isOpen && searchInputRef.current) {
      searchInputRef.current.focus();
    }
  }, [isOpen]);

  const handleSelectPrompt = (promptId: string | null) => {
    onChange(promptId);
    closeDropdown();
  };

  const renderGroupNode = (node: GroupTreeNode) => {
    const paddingLeft = 12 + Math.max(0, node.depth - 1) * 12;
    const expanded = isExpanded(node.id);
    const isActive = activeGroupId === node.id;

    return (
      <div key={node.id} className="space-y-1">
        <button
          type="button"
          onClick={() => {
            setActiveGroupId(node.id);
            setExpandedGroupIds((prev) => ({ ...prev, [node.id]: true }));
          }}
          className={`w-full flex items-center gap-2 px-2 py-2 rounded text-left transition-colors ${
            isActive ? 'bg-cyan-500/10 text-cyan-200 light:bg-cyan-50 light:text-cyan-700' : 'hover:bg-slate-700/50 light:hover:bg-slate-100'
          }`}
          style={{ paddingLeft }}
        >
          {node.children.length > 0 ? (
            <span
              role="button"
              tabIndex={0}
              onClick={(e) => {
                e.stopPropagation();
                toggleExpanded(node.id);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  e.stopPropagation();
                  toggleExpanded(node.id);
                }
              }}
              className="w-4 h-4 flex items-center justify-center flex-shrink-0"
            >
              {expanded ? (
                <ChevronDown className="w-4 h-4 text-slate-500 light:text-slate-400" />
              ) : (
                <ChevronRight className="w-4 h-4 text-slate-500 light:text-slate-400" />
              )}
            </span>
          ) : (
            <span className="w-4 h-4 flex-shrink-0" />
          )}
          <Folder className="w-4 h-4 text-slate-500 light:text-slate-400 flex-shrink-0" />
          <span className="text-sm truncate">{node.name}</span>
        </button>

        {expanded && node.children.length > 0 && (
          <div className="space-y-1">
            {node.children.map((child) => renderGroupNode(child))}
          </div>
        )}
      </div>
    );
  };

  const currentPrompts = useMemo(() => {
    const list = promptsByGroupId.get(activeGroupId ?? null) ?? [];
    return [...list].sort((a, b) => {
      const orderDiff = ((a.orderIndex as number) || 0) - ((b.orderIndex as number) || 0);
      if (orderDiff !== 0) return orderDiff;
      return a.name.localeCompare(b.name);
    });
  }, [activeGroupId, promptsByGroupId]);

  const ungroupedLabel = tPrompts('ungrouped');

  return (
    <div className="space-y-1.5">
      {label && (
        <label className="block text-sm font-medium text-slate-300 light:text-slate-700">
          {label}
        </label>
      )}

      <div ref={containerRef} className={`relative ${className}`}>
        <button
          type="button"
          onClick={() => (isOpen ? closeDropdown() : openDropdown())}
          disabled={disabled}
          className={`
            w-full flex items-center justify-between gap-2 px-3 py-2
            bg-slate-800 light:bg-white border rounded-lg
            text-sm text-left
            ${error ? 'border-rose-500' : 'border-slate-700 light:border-slate-300'}
            ${disabled ? 'opacity-50 cursor-not-allowed' : 'hover:border-cyan-500 cursor-pointer'}
            transition-colors
          `}
          title={displayLabel}
        >
          <div className="flex items-center gap-2 min-w-0">
            {selectedPrompt ? (
              <span className="text-slate-200 light:text-slate-800 truncate">{displayLabel}</span>
            ) : (
              <span className="text-slate-500 truncate">{displayLabel}</span>
            )}
          </div>
          <ChevronDown className={`w-4 h-4 text-slate-400 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
        </button>

        {isOpen && (
          <div
            className={`absolute z-50 w-full min-w-[360px] bg-slate-800 light:bg-white border border-slate-600 light:border-slate-300 rounded-lg shadow-xl overflow-hidden ${
              openDirection === 'up' ? 'bottom-full mb-1' : 'top-full mt-1'
            }`}
          >
            <div className="p-2 border-b border-slate-700 light:border-slate-200">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                <input
                  ref={searchInputRef}
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder={tPrompts('searchPlaceholder')}
                  className="w-full pl-9 pr-3 py-2 bg-slate-700 light:bg-slate-100 border-0 rounded-lg text-sm text-slate-200 light:text-slate-800 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-cyan-500/50"
                />
              </div>
            </div>

            <div className="max-h-[320px] overflow-hidden">
              {/* Clear / none option */}
              {allowClear && (
                <button
                  type="button"
                  onClick={() => handleSelectPrompt(null)}
                  className="w-full flex items-center justify-between gap-2 px-3 py-2 text-left border-b border-slate-700 light:border-slate-200 hover:bg-slate-700 light:hover:bg-slate-100 transition-colors"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <Unlink className="w-4 h-4 text-slate-500 flex-shrink-0" />
                    <span className="text-sm text-slate-200 light:text-slate-800 truncate">
                      {clearLabel || tCommon('none')}
                    </span>
                  </div>
                  {!value && <Check className="w-4 h-4 text-cyan-400 flex-shrink-0" />}
                </button>
              )}

              {searchQuery.trim() ? (
                <div className="max-h-[280px] overflow-y-auto">
                  {filteredPrompts.length === 0 ? (
                    <div className="p-4 text-center text-slate-500 text-sm">{tPrompts('noResults')}</div>
                  ) : (
                    filteredPrompts.map((p) => (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => handleSelectPrompt(p.id)}
                        className={`w-full flex items-center justify-between gap-2 px-3 py-2 text-left hover:bg-slate-700 light:hover:bg-slate-100 transition-colors ${
                          value === p.id ? 'bg-slate-700/50 light:bg-cyan-50' : ''
                        }`}
                        title={getPromptPathLabel(p)}
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <FileText className="w-4 h-4 text-slate-500 flex-shrink-0" />
                          <span className="text-sm text-slate-200 light:text-slate-800 truncate">
                            {getPromptPathLabel(p)}
                          </span>
                        </div>
                        {value === p.id && <Check className="w-4 h-4 text-cyan-400 flex-shrink-0" />}
                      </button>
                    ))
                  )}
                </div>
              ) : (
                <div className="flex h-[280px]">
                  {/* Left: groups */}
                  <div className="w-1/2 border-r border-slate-700 light:border-slate-200 overflow-y-auto p-2">
                    <button
                      type="button"
                      onClick={() => setActiveGroupId(null)}
                      className={`w-full flex items-center gap-2 px-2 py-2 rounded text-left transition-colors ${
                        activeGroupId === null
                          ? 'bg-cyan-500/10 text-cyan-200 light:bg-cyan-50 light:text-cyan-700'
                          : 'hover:bg-slate-700/50 light:hover:bg-slate-100'
                      }`}
                    >
                      <Folder className="w-4 h-4 text-slate-500 light:text-slate-400 flex-shrink-0" />
                      <span className="text-sm truncate">{ungroupedLabel}</span>
                    </button>

                    <div className="mt-1 space-y-1">
                      {groupTree.map((node) => renderGroupNode(node))}
                    </div>
                  </div>

                  {/* Right: prompts */}
                  <div className="w-1/2 overflow-y-auto">
                    {currentPrompts.length === 0 ? (
                      <div className="p-4 text-center text-slate-500 text-sm">{tPrompts('noPrompts')}</div>
                    ) : (
                      currentPrompts.map((p) => (
                        <button
                          key={p.id}
                          type="button"
                          onClick={() => handleSelectPrompt(p.id)}
                          className={`w-full flex items-center justify-between gap-2 px-3 py-2 text-left hover:bg-slate-700 light:hover:bg-slate-100 transition-colors ${
                            value === p.id ? 'bg-slate-700/50 light:bg-cyan-50' : ''
                          }`}
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            <FileText className="w-4 h-4 text-slate-500 flex-shrink-0" />
                            <span className="text-sm text-slate-200 light:text-slate-800 truncate">{p.name}</span>
                          </div>
                          {value === p.id && <Check className="w-4 h-4 text-cyan-400 flex-shrink-0" />}
                        </button>
                      ))
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {error && <p className="text-xs text-rose-500 mt-1.5">{error}</p>}
      </div>
    </div>
  );
}

