import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import type { Trace, TraceListItem, PromptListItem, FileAttachment } from '../types';
import { tracesApi, promptsApi } from '../api';

interface PromptStats {
  promptId: string | null;
  promptName: string;
  count: number;
  totalTokens: number;
  avgLatency: number;
  errorCount: number;
}

interface TracesState {
  // Data - using list types for API responses
  traces: TraceListItem[];
  prompts: PromptListItem[];
  selectedTraceId: string | null;
  selectedTrace: Trace | null;  // Full trace data when selected

  // Filtering
  selectedPromptId: string | null;
  filterStatus: 'all' | 'success' | 'error';
  searchQuery: string;

  // Pagination
  page: number;
  pageSize: number;
  totalCount: number;
  hasMore: boolean;

  // Loading states
  loading: boolean;
  loadingMore: boolean;
  attachmentsLoading: boolean;

  // UI state
  showDeleteConfirm: boolean;
  deleting: boolean;
  copiedField: 'input' | 'output' | null;
  expandedField: 'input' | 'output' | null;
  expandedContent: string;
  previewAttachment: FileAttachment | null;

  // Actions - Data fetching
  fetchTraces: (reset?: boolean) => Promise<void>;
  loadMoreTraces: () => Promise<void>;
  fetchPrompts: () => Promise<void>;
  loadTraceAttachments: (traceId: string) => Promise<FileAttachment[] | null>;

  // Actions - Selection
  selectTrace: (id: string | null) => void;
  setSelectedPromptId: (id: string | null) => void;
  setFilterStatus: (status: 'all' | 'success' | 'error') => void;
  setSearchQuery: (query: string) => void;

  // Actions - Delete
  deleteTrace: (id: string) => Promise<boolean>;
  deleteTracesByPrompt: (promptId: string | null) => Promise<boolean>;
  setShowDeleteConfirm: (show: boolean) => void;

  // Actions - UI
  setCopiedField: (field: 'input' | 'output' | null) => void;
  setExpandedField: (field: 'input' | 'output' | null) => void;
  setExpandedContent: (content: string) => void;
  setPreviewAttachment: (attachment: FileAttachment | null) => void;

  // Actions - Reset
  resetStore: () => void;

  // Computed
  getPromptStats: () => PromptStats[];
  getFilteredTraces: () => Trace[];
}

export const useTracesStore = create<TracesState>()(
  devtools(
    (set, get) => ({
      // Initial state
      traces: [],
      prompts: [],
      selectedTraceId: null,

      selectedPromptId: null,
      filterStatus: 'all',
      searchQuery: '',

      page: 1,
      pageSize: 50, // Real pagination instead of hardcoded 500
      totalCount: 0,
      hasMore: true,

      loading: false,
      loadingMore: false,
      attachmentsLoading: false,

      showDeleteConfirm: false,
      deleting: false,
      copiedField: null,
      expandedField: null,
      expandedContent: '',
      previewAttachment: null,

      // Actions
      resetStore: () =>
        set({
          traces: [],
          prompts: [],
          selectedTraceId: null,
          selectedTrace: null,
          selectedPromptId: null,
          filterStatus: 'all',
          searchQuery: '',
          page: 1,
          pageSize: 50,
          totalCount: 0,
          hasMore: true,
          loading: false,
          loadingMore: false,
          attachmentsLoading: false,
          showDeleteConfirm: false,
          deleting: false,
          copiedField: null,
          expandedField: null,
          expandedContent: '',
          previewAttachment: null,
        }),

      fetchTraces: async (reset = false) => {
        const state = get();
        if (state.loading || state.loadingMore) return;

        const isReset = reset || state.traces.length === 0;
        set({ [isReset ? 'loading' : 'loadingMore']: true });

        const page = isReset ? 1 : state.page;

        try {
          const response = await tracesApi.list({
            page,
            limit: state.pageSize,
            promptId: state.selectedPromptId || undefined,
            status: state.filterStatus !== 'all' ? state.filterStatus : undefined,
          });

          // Use API response directly (camelCase)
          const newTraces = response.data;

          set({
            traces: isReset ? newTraces : [...state.traces, ...newTraces],
            totalCount: response.total,
            hasMore: newTraces.length >= state.pageSize,
            page: isReset ? 1 : page,
          });
        } catch (error) {
          console.error('Failed to fetch traces:', error);
        } finally {
          set({ loading: false, loadingMore: false });
        }
      },

      loadMoreTraces: async () => {
        const state = get();
        if (!state.hasMore || state.loading || state.loadingMore) return;

        const page = state.page + 1;
        set({ page, loadingMore: true });

        try {
          const response = await tracesApi.list({
            page,
            limit: state.pageSize,
            promptId: state.selectedPromptId || undefined,
            status: state.filterStatus !== 'all' ? state.filterStatus : undefined,
          });

          // Use API response directly (camelCase)
          const newTraces = response.data;

          set(s => ({
            traces: [...s.traces, ...newTraces],
            hasMore: newTraces.length >= s.pageSize,
          }));
        } catch (error) {
          console.error('Failed to load more traces:', error);
        } finally {
          set({ loadingMore: false });
        }
      },

      fetchPrompts: async () => {
        try {
          const data = await promptsApi.list();
          // Use API response directly
          set({ prompts: data });
        } catch (error) {
          console.error('Failed to fetch prompts:', error);
        }
      },

      loadTraceAttachments: async (traceId: string) => {
        set({ attachmentsLoading: true });
        try {
          const data = await tracesApi.getById(traceId);
          const attachments = data.attachments || [];

          set(state => ({
            traces: state.traces.map(t =>
              t.id === traceId ? { ...t, attachments } : t
            )
          }));

          return attachments as FileAttachment[];
        } catch (error) {
          console.error('Failed to load attachments:', error);
          return null;
        } finally {
          set({ attachmentsLoading: false });
        }
      },

      selectTrace: (id) => {
        set({ selectedTraceId: id });
      },

      setSelectedPromptId: (id) => {
        set({ selectedPromptId: id, page: 1 });
        // Refetch with new filter
        get().fetchTraces(true);
      },

      setFilterStatus: (status) => {
        set({ filterStatus: status, page: 1 });
        get().fetchTraces(true);
      },

      setSearchQuery: (query) => {
        set({ searchQuery: query });
      },

      deleteTrace: async (id: string) => {
        try {
          await tracesApi.delete(id);

          set(state => ({
            traces: state.traces.filter(t => t.id !== id),
            selectedTraceId: state.selectedTraceId === id ? null : state.selectedTraceId,
            totalCount: Math.max(0, state.totalCount - 1),
          }));

          return true;
        } catch (error) {
          console.error('Failed to delete trace:', error);
          return false;
        }
      },

      deleteTracesByPrompt: async (promptId: string | null) => {
        set({ deleting: true });
        try {
          await tracesApi.deleteByPrompt(promptId);

          set({ showDeleteConfirm: false, selectedPromptId: null });
          await get().fetchTraces(true);
          return true;
        } catch (error) {
          console.error('Failed to delete traces:', error);
          return false;
        } finally {
          set({ deleting: false });
        }
      },

      setShowDeleteConfirm: (show) => set({ showDeleteConfirm: show }),
      setCopiedField: (field) => set({ copiedField: field }),
      setExpandedField: (field) => set({ expandedField: field }),
      setExpandedContent: (content) => set({ expandedContent: content }),
      setPreviewAttachment: (attachment) => set({ previewAttachment: attachment }),

      // Computed
      getPromptStats: () => {
        const state = get();
        const statsMap = new Map<string | null, PromptStats>();

        // Initialize with "unlinked" category
        statsMap.set(null, {
          promptId: null,
          promptName: '未关联',
          count: 0,
          totalTokens: 0,
          avgLatency: 0,
          errorCount: 0,
        });

        // Initialize prompt stats
        for (const prompt of state.prompts) {
          statsMap.set(prompt.id, {
            promptId: prompt.id,
            promptName: prompt.name,
            count: 0,
            totalTokens: 0,
            avgLatency: 0,
            errorCount: 0,
          });
        }

        // Calculate stats (use camelCase properties)
        for (const trace of state.traces) {
          const stats = statsMap.get(trace.promptId) || statsMap.get(null)!;
          stats.count++;
          stats.totalTokens += (trace.tokensInput || 0) + (trace.tokensOutput || 0);
          stats.avgLatency += trace.latencyMs || 0;
          if (trace.status === 'error') stats.errorCount++;
        }

        // Calculate averages
        for (const stats of statsMap.values()) {
          if (stats.count > 0) {
            stats.avgLatency = Math.round(stats.avgLatency / stats.count);
          }
        }

        return Array.from(statsMap.values()).filter(s => s.count > 0);
      },

      getFilteredTraces: () => {
        const state = get();
        // Note: TraceListItem doesn't have input/output fields
        // Search by content would require full trace data
        return state.traces;
      },
    }),
    { name: 'traces-store' }
  )
);

// Selectors
export const useSelectedTrace = () => {
  const traces = useTracesStore(state => state.traces);
  const selectedTraceId = useTracesStore(state => state.selectedTraceId);
  return traces.find(t => t.id === selectedTraceId) || null;
};
