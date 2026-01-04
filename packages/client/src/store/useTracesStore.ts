import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import type { Trace, Prompt } from '../types/database';
import type { FileAttachment } from '../lib/ai-service';
import { getDatabase, isDatabaseConfigured } from '../lib/database';

interface PromptStats {
  promptId: string | null;
  promptName: string;
  count: number;
  totalTokens: number;
  avgLatency: number;
  errorCount: number;
}

interface TracesState {
  // Data
  traces: Trace[];
  prompts: Prompt[];
  selectedTraceId: string | null;

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
      fetchTraces: async (reset = false) => {
        if (!isDatabaseConfigured()) {
          set({ loading: false });
          return;
        }

        const state = get();
        if (state.loading || state.loadingMore) return;

        const isReset = reset || state.traces.length === 0;
        set({ [isReset ? 'loading' : 'loadingMore']: true });

        const page = isReset ? 1 : state.page;
        const offset = (page - 1) * state.pageSize;

        try {
          const db = getDatabase();
          let query = db
            .from('traces')
            .select('id,user_id,prompt_id,model_id,input,output,tokens_input,tokens_output,latency_ms,status,error_message,metadata,created_at', { count: 'exact' })
            .order('created_at', { ascending: false })
            .range(offset, offset + state.pageSize - 1);

          // Apply filters
          if (state.selectedPromptId) {
            query = query.eq('prompt_id', state.selectedPromptId);
          }
          if (state.filterStatus !== 'all') {
            query = query.eq('status', state.filterStatus);
          }

          const { data, count, error } = await query;

          if (error) {
            console.error('Failed to fetch traces:', error);
            return;
          }

          const newTraces = data || [];
          set({
            traces: isReset ? newTraces : [...state.traces, ...newTraces],
            totalCount: count || 0,
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

        set({ page: state.page + 1, loadingMore: true });

        // Re-fetch with new page
        const page = state.page + 1;
        const offset = (page - 1) * state.pageSize;

        try {
          const db = getDatabase();
          let query = db
            .from('traces')
            .select('id,user_id,prompt_id,model_id,input,output,tokens_input,tokens_output,latency_ms,status,error_message,metadata,created_at')
            .order('created_at', { ascending: false })
            .range(offset, offset + state.pageSize - 1);

          if (state.selectedPromptId) {
            query = query.eq('prompt_id', state.selectedPromptId);
          }
          if (state.filterStatus !== 'all') {
            query = query.eq('status', state.filterStatus);
          }

          const { data } = await query;
          const newTraces = data || [];

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
        if (!isDatabaseConfigured()) return;

        try {
          const db = getDatabase();
          const { data } = await db.from('prompts').select('*');
          set({ prompts: data || [] });
        } catch (error) {
          console.error('Failed to fetch prompts:', error);
        }
      },

      loadTraceAttachments: async (traceId: string) => {
        set({ attachmentsLoading: true });
        try {
          const db = getDatabase();
          const { data } = await db
            .from('traces')
            .select('attachments')
            .eq('id', traceId)
            .single();

          const attachments = data?.attachments || [];

          // Update the trace in the store with the loaded attachments
          set(state => ({
            traces: state.traces.map(t =>
              t.id === traceId ? { ...t, attachments } : t
            )
          }));

          return attachments;
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
          const db = getDatabase();
          const { error } = await db.from('traces').delete().eq('id', id);

          if (error) {
            console.error('Failed to delete trace:', error);
            return false;
          }

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
          const db = getDatabase();
          const query = db.from('traces').delete();

          if (promptId === null) {
            await query.is('prompt_id', null);
          } else {
            await query.eq('prompt_id', promptId);
          }

          // Refresh traces
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

        // Calculate stats
        for (const trace of state.traces) {
          const stats = statsMap.get(trace.prompt_id) || statsMap.get(null)!;
          stats.count++;
          stats.totalTokens += (trace.tokens_input || 0) + (trace.tokens_output || 0);
          stats.avgLatency += trace.latency_ms || 0;
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
        let filtered = state.traces;

        if (state.searchQuery) {
          const query = state.searchQuery.toLowerCase();
          filtered = filtered.filter(t =>
            t.input.toLowerCase().includes(query) ||
            t.output.toLowerCase().includes(query)
          );
        }

        return filtered;
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
