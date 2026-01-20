import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import type {
  Prompt,
  PromptVersion,
  PromptVariable,
  FileAttachment,
  OcrProvider,
} from '../types';
import { PromptMessage, PromptConfig, DEFAULT_PROMPT_CONFIG } from '../types/database';
import { promptsApi } from '../api';
import { invalidatePromptsCache } from '../lib/cache-events';
import { toFrontendOutputSchema } from '../lib/output-schema';

// Type conversion helpers
const toFrontendMessages = (messages: unknown): PromptMessage[] => {
  const msgs = (messages || []) as Array<{ role?: string; content?: string; id?: string }>;
  return msgs.map((m, i) => ({
    id: m.id || `msg-${Date.now()}-${i}`,
    role: (m.role || 'user') as PromptMessage['role'],
    content: m.content || '',
  }));
};

const toFrontendConfig = (config: unknown): PromptConfig => {
  const c = (config || {}) as Record<string, unknown>;
  return {
    temperature: (c.temperature as number) ?? DEFAULT_PROMPT_CONFIG.temperature,
    top_p: (c.top_p as number) ?? DEFAULT_PROMPT_CONFIG.top_p,
    frequency_penalty: (c.frequency_penalty as number) ?? DEFAULT_PROMPT_CONFIG.frequency_penalty,
    presence_penalty: (c.presence_penalty as number) ?? DEFAULT_PROMPT_CONFIG.presence_penalty,
    max_tokens: (c.max_tokens as number) ?? DEFAULT_PROMPT_CONFIG.max_tokens,
    output_schema: toFrontendOutputSchema(c.output_schema),
    reasoning: c.reasoning as PromptConfig['reasoning'],
  };
};

// Debug run type (same as in DebugHistory component)
export interface DebugRun {
  id: string;
  input: string;
  inputVariables: Record<string, string>;
  output: string;
  status: 'success' | 'error';
  errorMessage?: string;
  latencyMs: number;
  tokensInput: number;
  tokensOutput: number;
  timestamp: Date;
  attachments?: FileAttachment[];
  thinking?: string;
  ocrUsed?: boolean;
  ocrProvider?: OcrProvider;
}

// Compare result type
export interface CompareResult {
  content: string;
  latency: number;
  tokensIn: number;
  tokensOut: number;
  error?: string;
}

// Compare state
export interface CompareState {
  mode: 'models' | 'versions';
  version: string;
  models: [string, string];
  model: string;
  versions: [string, string];
  input: string;
  files: FileAttachment[];
  running: boolean;
  results: {
    left: CompareResult | null;
    right: CompareResult | null;
  };
}

type TabType = 'edit' | 'observe' | 'optimize';

interface PromptsState {
  // Prompt list
  prompts: Prompt[];
  selectedPromptId: string | null;
  searchQuery: string;

  // Editing state
  editingContent: string;
  editingName: string;
  editingMessages: PromptMessage[];
  editingConfig: PromptConfig;
  editingVariables: PromptVariable[];

  // Selected model for testing
  selectedModelId: string;

  // Versions
  versions: PromptVersion[];
  showVersions: boolean;

  // Test state
  testInput: string;
  testOutput: string;
  variableValues: Record<string, string>;
  attachedFiles: FileAttachment[];
  isRunning: boolean;

  // Debug history
  debugRuns: DebugRun[];
  selectedDebugRunId: string | null;

  // Compare state (merged from 8+ separate states)
  compare: CompareState;
  showCompare: boolean;

  // Thinking block
  thinkingContent: string;
  isThinking: boolean;

  // UI state
  activeTab: TabType;
  autoSaveStatus: 'saved' | 'saving' | 'unsaved' | 'error';
  renderMarkdown: boolean;
  showNewPrompt: boolean;
  newPromptName: string;

  // Attachment preview
  previewAttachment: FileAttachment | null;

  // Debug detail modal
  showDebugDetail: DebugRun | null;

  // Actions - Data fetching
  fetchPrompts: () => Promise<void>;
  fetchVersions: (promptId: string) => Promise<void>;

  // Actions - Prompt selection
  selectPrompt: (id: string | null) => void;
  setSearchQuery: (query: string) => void;

  // Actions - Editing
  updateEditingContent: (content: string) => void;
  updateEditingName: (name: string) => void;
  updateEditingMessages: (messages: PromptMessage[]) => void;
  updateEditingConfig: (config: PromptConfig) => void;
  updateEditingVariables: (variables: PromptVariable[]) => void;
  setSelectedModelId: (modelId: string) => void;

  // Actions - Test
  setTestInput: (input: string) => void;
  setTestOutput: (output: string) => void;
  setVariableValues: (values: Record<string, string>) => void;
  addAttachment: (file: FileAttachment) => void;
  removeAttachment: (index: number) => void;
  clearAttachments: () => void;
  setIsRunning: (running: boolean) => void;

  // Actions - Debug history
  addDebugRun: (run: DebugRun) => void;
  removeDebugRun: (id: string) => void;
  clearDebugHistory: () => void;
  selectDebugRun: (id: string | null) => void;
  setShowDebugDetail: (run: DebugRun | null) => void;

  // Actions - Versions
  setShowVersions: (show: boolean) => void;

  // Actions - Compare
  setShowCompare: (show: boolean) => void;
  updateCompare: (update: Partial<CompareState>) => void;
  resetCompare: () => void;

  // Actions - Thinking
  setThinkingContent: (content: string) => void;
  setIsThinking: (thinking: boolean) => void;

  // Actions - UI
  setActiveTab: (tab: TabType) => void;
  setAutoSaveStatus: (status: 'saved' | 'saving' | 'unsaved' | 'error') => void;
  setRenderMarkdown: (render: boolean) => void;
  setShowNewPrompt: (show: boolean) => void;
  setNewPromptName: (name: string) => void;
  setPreviewAttachment: (attachment: FileAttachment | null) => void;

  // Actions - CRUD
  createPrompt: (name: string) => Promise<Prompt | null>;
  deletePrompt: (id: string) => Promise<boolean>;
  updatePromptOrder: (promptId: string, newIndex: number) => Promise<void>;

  // Actions - Reset
  resetEditingState: () => void;
  resetTestState: () => void;
}

const initialCompareState: CompareState = {
  mode: 'models',
  version: '',
  models: ['', ''],
  model: '',
  versions: ['', ''],
  input: '',
  files: [],
  running: false,
  results: { left: null, right: null },
};

export const usePromptsStore = create<PromptsState>()(
  devtools(
    (set, get) => ({
      // Initial state
      prompts: [],
      selectedPromptId: null,
      searchQuery: '',

      editingContent: '',
      editingName: '',
      editingMessages: [],
      editingConfig: DEFAULT_PROMPT_CONFIG,
      editingVariables: [],

      selectedModelId: '',

      versions: [],
      showVersions: false,

      testInput: '',
      testOutput: '',
      variableValues: {},
      attachedFiles: [],
      isRunning: false,

      debugRuns: [],
      selectedDebugRunId: null,

      compare: initialCompareState,
      showCompare: false,

      thinkingContent: '',
      isThinking: false,

      activeTab: 'edit',
      autoSaveStatus: 'saved',
      renderMarkdown: true,
      showNewPrompt: false,
      newPromptName: '',

      previewAttachment: null,
      showDebugDetail: null,

      // Actions implementation
      fetchPrompts: async () => {
        try {
          const data = await promptsApi.list();
          // Fetch full prompt data for each prompt
          const prompts: Prompt[] = await Promise.all(
            data.map(async (p) => {
              const full = await promptsApi.getById(p.id);
              return {
                ...full,
                description: full.description || '',
                content: full.content || '',
                variables: full.variables || [],
                messages: full.messages || [],
                config: full.config || DEFAULT_PROMPT_CONFIG,
              };
            })
          );

          set({ prompts });

          // Auto-select first prompt if none selected
          const state = get();
          if (prompts.length > 0 && !state.selectedPromptId) {
            get().selectPrompt(prompts[0].id);
          }
        } catch (error) {
          console.error('Failed to fetch prompts:', error);
        }
      },

      fetchVersions: async (promptId: string) => {
        try {
          const versions = await promptsApi.getVersions(promptId);
          set({ versions });
        } catch (error) {
          console.error('Failed to fetch versions:', error);
        }
      },

      selectPrompt: (id) => {
        const prompt = get().prompts.find(p => p.id === id);

        if (prompt) {
          set({
            selectedPromptId: id,
            editingContent: prompt.content || '',
            editingName: prompt.name,
            editingMessages: toFrontendMessages(prompt.messages),
            editingConfig: toFrontendConfig(prompt.config),
            editingVariables: prompt.variables || [],
            selectedModelId: prompt.defaultModelId || '',
            autoSaveStatus: 'saved',
            // Reset test state
            testInput: '',
            testOutput: '',
            variableValues: {},
            attachedFiles: [],
            debugRuns: [],
            selectedDebugRunId: null,
            thinkingContent: '',
            isThinking: false,
          });

          // Fetch versions for this prompt
          if (id) {
            get().fetchVersions(id);
          }
        } else {
          set({ selectedPromptId: null });
        }
      },

      setSearchQuery: (query) => set({ searchQuery: query }),

      // Editing actions
      updateEditingContent: (content) => {
        set({ editingContent: content, autoSaveStatus: 'unsaved' });
      },

      updateEditingName: (name) => {
        set({ editingName: name, autoSaveStatus: 'unsaved' });
      },

      updateEditingMessages: (messages) => {
        set({ editingMessages: messages, autoSaveStatus: 'unsaved' });
      },

      updateEditingConfig: (config) => {
        set({ editingConfig: config, autoSaveStatus: 'unsaved' });
      },

      updateEditingVariables: (variables) => {
        set({ editingVariables: variables, autoSaveStatus: 'unsaved' });
      },

      setSelectedModelId: (modelId) => set({ selectedModelId: modelId }),

      // Test actions
      setTestInput: (input) => set({ testInput: input }),
      setTestOutput: (output) => set({ testOutput: output }),
      setVariableValues: (values) => set({ variableValues: values }),

      addAttachment: (file) => {
        set(state => ({ attachedFiles: [...state.attachedFiles, file] }));
      },

      removeAttachment: (index) => {
        set(state => ({
          attachedFiles: state.attachedFiles.filter((_, i) => i !== index),
        }));
      },

      clearAttachments: () => set({ attachedFiles: [] }),
      setIsRunning: (running) => set({ isRunning: running }),

      // Debug history actions
      addDebugRun: (run) => {
        set(state => ({
          debugRuns: [run, ...state.debugRuns].slice(0, 20), // Keep max 20
        }));
      },

      removeDebugRun: (id) => {
        set(state => ({
          debugRuns: state.debugRuns.filter(r => r.id !== id),
          selectedDebugRunId: state.selectedDebugRunId === id ? null : state.selectedDebugRunId,
        }));
      },

      clearDebugHistory: () => {
        set({ debugRuns: [], selectedDebugRunId: null });
      },

      selectDebugRun: (id) => set({ selectedDebugRunId: id }),
      setShowDebugDetail: (run) => set({ showDebugDetail: run }),

      // Version actions
      setShowVersions: (show) => set({ showVersions: show }),

      // Compare actions
      setShowCompare: (show) => set({ showCompare: show }),

      updateCompare: (update) => {
        set(state => ({
          compare: { ...state.compare, ...update },
        }));
      },

      resetCompare: () => {
        set({ compare: initialCompareState });
      },

      // Thinking actions
      setThinkingContent: (content) => set({ thinkingContent: content }),
      setIsThinking: (thinking) => set({ isThinking: thinking }),

      // UI actions
      setActiveTab: (tab) => set({ activeTab: tab }),
      setAutoSaveStatus: (status) => set({ autoSaveStatus: status }),
      setRenderMarkdown: (render) => set({ renderMarkdown: render }),
      setShowNewPrompt: (show) => set({ showNewPrompt: show }),
      setNewPromptName: (name) => set({ newPromptName: name }),
      setPreviewAttachment: (attachment) => set({ previewAttachment: attachment }),

      // CRUD actions
      createPrompt: async (name: string) => {
        try {
          const data = await promptsApi.create({ name });
          const newPrompt: Prompt = {
            ...data,
            description: data.description || '',
            content: data.content || '',
            variables: data.variables || [],
            messages: data.messages || [],
            config: data.config || DEFAULT_PROMPT_CONFIG,
          };

          set(state => ({
            prompts: [...state.prompts, newPrompt],
            showNewPrompt: false,
            newPromptName: '',
          }));

          invalidatePromptsCache(newPrompt);
          get().selectPrompt(newPrompt.id);
          return newPrompt;
        } catch (error) {
          console.error('Failed to create prompt:', error);
          return null;
        }
      },

      deletePrompt: async (id: string) => {
        try {
          await promptsApi.delete(id);

          const state = get();
          const newPrompts = state.prompts.filter(p => p.id !== id);

          set({ prompts: newPrompts });

          // Select another prompt if the deleted one was selected
          if (state.selectedPromptId === id) {
            if (newPrompts.length > 0) {
              get().selectPrompt(newPrompts[0].id);
            } else {
              set({ selectedPromptId: null });
              get().resetEditingState();
            }
          }

          return true;
        } catch (error) {
          console.error('Failed to delete prompt:', error);
          return false;
        }
      },

      updatePromptOrder: async (promptId: string, newIndex: number) => {
        const state = get();
        const prompts = [...state.prompts];
        const currentIndex = prompts.findIndex(p => p.id === promptId);

        if (currentIndex === -1 || currentIndex === newIndex) return;

        const [removed] = prompts.splice(currentIndex, 1);
        prompts.splice(newIndex, 0, removed);

        // Update orderIndex for all prompts
        const updates = prompts.map((p, i) => ({ ...p, orderIndex: i }));
        set({ prompts: updates });

        // Persist to backend
        try {
          await promptsApi.batchUpdateOrder(
            updates.map(p => ({ id: p.id, orderIndex: p.orderIndex }))
          );
        } catch (error) {
          console.error('Failed to update prompt order:', error);
        }
      },

      // Reset actions
      resetEditingState: () => {
        set({
          editingContent: '',
          editingName: '',
          editingMessages: [],
          editingConfig: DEFAULT_PROMPT_CONFIG,
          editingVariables: [],
          selectedModelId: '',
          autoSaveStatus: 'saved',
        });
      },

      resetTestState: () => {
        set({
          testInput: '',
          testOutput: '',
          variableValues: {},
          attachedFiles: [],
          debugRuns: [],
          selectedDebugRunId: null,
          thinkingContent: '',
          isThinking: false,
        });
      },
    }),
    { name: 'prompts-store' }
  )
);

// Selectors
export const useSelectedPrompt = () => {
  const prompts = usePromptsStore(state => state.prompts);
  const selectedPromptId = usePromptsStore(state => state.selectedPromptId);
  return prompts.find(p => p.id === selectedPromptId) || null;
};

export const useFilteredPrompts = () => {
  const prompts = usePromptsStore(state => state.prompts);
  const searchQuery = usePromptsStore(state => state.searchQuery);

  if (!searchQuery) return prompts;

  const query = searchQuery.toLowerCase();
  return prompts.filter(p => p.name.toLowerCase().includes(query));
};
