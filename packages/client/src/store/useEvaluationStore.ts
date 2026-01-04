import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import type {
  Evaluation,
  Prompt,
  TestCase,
  EvaluationCriterion,
  TestCaseResult,
  EvaluationRun,
} from '../types/database';
import { getDatabase, isDatabaseConfigured } from '../lib/database';

type TabType = 'testcases' | 'criteria' | 'history' | 'results';

// 缓存数据结构
interface EvaluationCache {
  testCases: TestCase[];
  criteria: EvaluationCriterion[];
  runs: EvaluationRun[];
  results: TestCaseResult[];
  selectedRunId: string | null;
}

interface EvaluationState {
  // List data
  evaluations: Evaluation[];
  prompts: Prompt[];
  listLoaded: boolean;  // 评测列表是否已加载

  // Selection
  selectedEvaluationId: string | null;

  // Details
  testCases: TestCase[];
  criteria: EvaluationCriterion[];
  results: TestCaseResult[];
  runs: EvaluationRun[];
  selectedRunId: string | null;

  // 缓存
  cache: Map<string, EvaluationCache>;

  // Running state
  runningCount: number;
  abortControllers: Map<string, { aborted: boolean }>;

  // UI state
  activeTab: TabType;
  listLoading: boolean;
  detailsLoading: boolean;
  showNewEval: boolean;

  // New evaluation form
  newEvalName: string;
  newEvalPromptId: string;
  newEvalModelId: string;
  newEvalJudgeModelId: string;

  // Edit name
  isEditingName: boolean;
  editingName: string;

  // Actions - Data fetching
  fetchEvaluations: (forceRefresh?: boolean) => Promise<void>;
  fetchPrompts: () => Promise<void>;
  fetchEvaluationDetails: (evaluationId: string, forceRefresh?: boolean) => Promise<void>;
  fetchRunResults: (runId: string) => Promise<void>;

  // Actions - Selection
  selectEvaluation: (id: string | null) => void;
  selectRun: (runId: string) => Promise<void>;
  setActiveTab: (tab: TabType) => void;

  // Actions - CRUD Evaluation
  createEvaluation: () => Promise<Evaluation | null>;
  deleteEvaluation: (id: string) => Promise<boolean>;
  copyEvaluation: (id: string) => Promise<Evaluation | null>;
  updateEvaluationField: (field: string, value: unknown) => Promise<boolean>;

  // Actions - Test Cases
  addTestCase: () => Promise<TestCase | null>;
  updateTestCase: (testCase: TestCase) => Promise<boolean>;
  deleteTestCase: (id: string) => Promise<boolean>;

  // Actions - Criteria
  addCriterion: (criterion: Omit<EvaluationCriterion, 'id' | 'evaluation_id' | 'created_at'>) => Promise<EvaluationCriterion | null>;
  updateCriterion: (criterion: EvaluationCriterion) => Promise<boolean>;
  deleteCriterion: (id: string) => Promise<boolean>;

  // Actions - Run
  deleteRun: (runId: string) => Promise<boolean>;
  incrementRunningCount: () => void;
  decrementRunningCount: () => void;

  // Actions - Batch update (for performance)
  appendResults: (results: TestCaseResult[]) => void;
  setResults: (results: TestCaseResult[]) => void;
  updateRuns: (runs: EvaluationRun[]) => void;

  // Actions - UI
  setShowNewEval: (show: boolean) => void;
  setNewEvalName: (name: string) => void;
  setNewEvalPromptId: (id: string) => void;
  setNewEvalModelId: (id: string) => void;
  setNewEvalJudgeModelId: (id: string) => void;
  setIsEditingName: (editing: boolean) => void;
  setEditingName: (name: string) => void;

  // Actions - Cache
  updateCache: (evaluationId: string, updates: Partial<EvaluationCache>) => void;
  clearCache: (evaluationId: string) => void;
  clearAllCache: () => void;

  // Actions - Reset
  resetNewEvalForm: () => void;
}

export const useEvaluationStore = create<EvaluationState>()(
  devtools(
    (set, get) => ({
      // Initial state
      evaluations: [],
      prompts: [],
      listLoaded: false,
      selectedEvaluationId: null,

      testCases: [],
      criteria: [],
      results: [],
      runs: [],
      selectedRunId: null,

      cache: new Map(),

      runningCount: 0,
      abortControllers: new Map(),

      activeTab: 'testcases',
      listLoading: false,
      detailsLoading: false,
      showNewEval: false,

      newEvalName: '',
      newEvalPromptId: '',
      newEvalModelId: '',
      newEvalJudgeModelId: '',

      isEditingName: false,
      editingName: '',

      // Actions
      fetchEvaluations: async (forceRefresh = false) => {
        if (!isDatabaseConfigured()) {
          set({ listLoading: false });
          return;
        }

        // 如果已加载且不强制刷新，直接返回
        const state = get();
        if (state.listLoaded && !forceRefresh) {
          return;
        }

        set({ listLoading: true });
        try {
          const db = getDatabase();
          const { data } = await db
            .from('evaluations')
            .select('*')
            .order('created_at', { ascending: false });

          set({ evaluations: data || [], listLoaded: true });
        } catch (error) {
          console.error('Failed to fetch evaluations:', error);
        } finally {
          set({ listLoading: false });
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

      fetchEvaluationDetails: async (evaluationId: string, forceRefresh = false) => {
        const state = get();

        // 检查缓存
        const cached = state.cache.get(evaluationId);
        if (cached && !forceRefresh) {
          // 直接使用缓存，不显示加载状态
          set({
            testCases: cached.testCases,
            criteria: cached.criteria,
            runs: cached.runs,
            results: cached.results,
            selectedRunId: cached.selectedRunId,
          });
          return;
        }

        set({ detailsLoading: true });
        try {
          const db = getDatabase();
          const [testCasesRes, criteriaRes, runsRes] = await Promise.all([
            db.from('test_cases').select('*').eq('evaluation_id', evaluationId).order('order_index'),
            db.from('evaluation_criteria').select('*').eq('evaluation_id', evaluationId).order('created_at'),
            db.from('evaluation_runs').select('*').eq('evaluation_id', evaluationId).order('created_at', { ascending: false }),
          ]);

          const testCases = (testCasesRes.data || []).map(tc => ({
            ...tc,
            attachments: tc.attachments || [],
            notes: tc.notes || null,
          }));
          const criteria = criteriaRes.data || [];
          const runs = runsRes.data || [];

          // Find latest completed run and load its results
          const latestCompletedRun = runs.find(r => r.status === 'completed');
          let results: TestCaseResult[] = [];
          let selectedRunId: string | null = null;

          if (latestCompletedRun) {
            selectedRunId = latestCompletedRun.id;
            const resultsRes = await db
              .from('test_case_results')
              .select('*')
              .eq('run_id', latestCompletedRun.id)
              .order('created_at');
            results = resultsRes.data || [];
          }

          // 只有当前选中的还是这个评测时才更新状态
          if (get().selectedEvaluationId === evaluationId) {
            set({
              testCases,
              criteria,
              runs,
              results,
              selectedRunId,
            });
          }

          // 存入缓存
          const newCache = new Map(get().cache);
          newCache.set(evaluationId, {
            testCases,
            criteria,
            runs,
            results,
            selectedRunId,
          });
          set({ cache: newCache });
        } catch (error) {
          console.error('Failed to fetch evaluation details:', error);
        } finally {
          // 只有当前选中的还是这个评测时才取消加载状态
          if (get().selectedEvaluationId === evaluationId) {
            set({ detailsLoading: false });
          }
        }
      },

      fetchRunResults: async (runId: string) => {
        try {
          const db = getDatabase();
          const { data } = await db
            .from('test_case_results')
            .select('*')
            .eq('run_id', runId)
            .order('created_at');

          const state = get();
          set({ results: data || [] });

          // 更新缓存
          if (state.selectedEvaluationId) {
            get().updateCache(state.selectedEvaluationId, {
              results: data || [],
              selectedRunId: runId,
            });
          }
        } catch (error) {
          console.error('Failed to fetch run results:', error);
        }
      },

      selectEvaluation: (id) => {
        const state = get();

        // 如果选中的是同一个评测，不做任何操作
        if (state.selectedEvaluationId === id) return;

        // 检查缓存
        const cached = id ? state.cache.get(id) : null;

        if (cached) {
          // 有缓存，直接使用，不显示加载状态
          set({
            selectedEvaluationId: id,
            testCases: cached.testCases,
            criteria: cached.criteria,
            results: cached.results,
            runs: cached.runs,
            selectedRunId: cached.selectedRunId,
            activeTab: 'testcases',
            detailsLoading: false,
          });
        } else {
          // 没有缓存，清空当前数据并开始加载
          set({
            selectedEvaluationId: id,
            testCases: [],
            criteria: [],
            results: [],
            runs: [],
            selectedRunId: null,
            activeTab: 'testcases',
          });

          if (id) {
            get().fetchEvaluationDetails(id);
          }
        }
      },

      selectRun: async (runId: string) => {
        set({ selectedRunId: runId });
        await get().fetchRunResults(runId);
        set({ activeTab: 'results' });
      },

      setActiveTab: (tab) => set({ activeTab: tab }),

      createEvaluation: async () => {
        const state = get();
        if (!state.newEvalName.trim()) return null;

        try {
          const db = getDatabase();
          const { data, error } = await db
            .from('evaluations')
            .insert({
              user_id: 'default',
              name: state.newEvalName.trim(),
              prompt_id: state.newEvalPromptId || null,
              model_id: state.newEvalModelId || null,
              judge_model_id: state.newEvalJudgeModelId || null,
              status: 'pending',
              config: {},
              results: {},
            })
            .select()
            .single();

          if (error || !data) {
            console.error('Failed to create evaluation:', error);
            return null;
          }

          set(s => ({
            evaluations: [data, ...s.evaluations],
            showNewEval: false,
          }));

          get().resetNewEvalForm();
          get().selectEvaluation(data.id);

          return data;
        } catch (error) {
          console.error('Failed to create evaluation:', error);
          return null;
        }
      },

      deleteEvaluation: async (id: string) => {
        try {
          const db = getDatabase();
          const { error } = await db.from('evaluations').delete().eq('id', id);

          if (error) {
            console.error('Failed to delete evaluation:', error);
            return false;
          }

          const state = get();
          const newEvaluations = state.evaluations.filter(e => e.id !== id);

          // 清除缓存
          get().clearCache(id);

          set({ evaluations: newEvaluations });

          if (state.selectedEvaluationId === id) {
            get().selectEvaluation(newEvaluations.length > 0 ? newEvaluations[0].id : null);
          }

          return true;
        } catch (error) {
          console.error('Failed to delete evaluation:', error);
          return false;
        }
      },

      copyEvaluation: async (id: string) => {
        const evaluation = get().evaluations.find(e => e.id === id);
        if (!evaluation) return null;

        try {
          const db = getDatabase();

          // Create new evaluation
          const { data: newEval, error: evalError } = await db
            .from('evaluations')
            .insert({
              user_id: 'default',
              name: `${evaluation.name} (副本)`,
              prompt_id: evaluation.prompt_id,
              model_id: evaluation.model_id,
              judge_model_id: evaluation.judge_model_id,
              status: 'pending',
              config: evaluation.config,
              results: {},
            })
            .select()
            .single();

          if (evalError || !newEval) return null;

          // Copy test cases
          const { data: testCases } = await db
            .from('test_cases')
            .select('*')
            .eq('evaluation_id', id);

          if (testCases && testCases.length > 0) {
            await db.from('test_cases').insert(
              testCases.map(tc => ({
                evaluation_id: newEval.id,
                name: tc.name,
                input_text: tc.input_text,
                input_variables: tc.input_variables,
                attachments: tc.attachments,
                expected_output: tc.expected_output,
                notes: tc.notes,
                order_index: tc.order_index,
              }))
            );
          }

          // Copy criteria
          const { data: criteria } = await db
            .from('evaluation_criteria')
            .select('*')
            .eq('evaluation_id', id);

          if (criteria && criteria.length > 0) {
            await db.from('evaluation_criteria').insert(
              criteria.map(c => ({
                evaluation_id: newEval.id,
                name: c.name,
                description: c.description,
                prompt: c.prompt,
                weight: c.weight,
                enabled: c.enabled,
              }))
            );
          }

          set(s => ({ evaluations: [newEval, ...s.evaluations] }));
          get().selectEvaluation(newEval.id);

          return newEval;
        } catch (error) {
          console.error('Failed to copy evaluation:', error);
          return null;
        }
      },

      updateEvaluationField: async (field: string, value: unknown) => {
        const state = get();
        if (!state.selectedEvaluationId) return false;

        try {
          const db = getDatabase();
          const { error } = await db
            .from('evaluations')
            .update({ [field]: value })
            .eq('id', state.selectedEvaluationId);

          if (error) return false;

          set(s => ({
            evaluations: s.evaluations.map(e =>
              e.id === state.selectedEvaluationId ? { ...e, [field]: value } : e
            ),
          }));

          return true;
        } catch {
          return false;
        }
      },

      // Test Cases
      addTestCase: async () => {
        const state = get();
        if (!state.selectedEvaluationId) return null;

        try {
          const db = getDatabase();
          const { data, error } = await db
            .from('test_cases')
            .insert({
              evaluation_id: state.selectedEvaluationId,
              name: '',
              input_text: '',
              input_variables: {},
              attachments: [],
              expected_output: null,
              notes: null,
              order_index: state.testCases.length,
            })
            .select()
            .single();

          if (error || !data) return null;

          const newTestCases = [...state.testCases, data];
          set({ testCases: newTestCases });
          get().updateCache(state.selectedEvaluationId, { testCases: newTestCases });
          return data;
        } catch {
          return null;
        }
      },

      updateTestCase: async (testCase: TestCase) => {
        const state = get();
        if (!state.selectedEvaluationId) return false;

        try {
          const db = getDatabase();
          const { error } = await db
            .from('test_cases')
            .update({
              name: testCase.name,
              input_text: testCase.input_text,
              input_variables: testCase.input_variables,
              attachments: testCase.attachments,
              expected_output: testCase.expected_output,
              notes: testCase.notes,
              order_index: testCase.order_index,
            })
            .eq('id', testCase.id);

          if (error) return false;

          const newTestCases = state.testCases.map(tc =>
            tc.id === testCase.id ? testCase : tc
          );
          set({ testCases: newTestCases });
          get().updateCache(state.selectedEvaluationId, { testCases: newTestCases });
          return true;
        } catch {
          return false;
        }
      },

      deleteTestCase: async (id: string) => {
        const state = get();
        if (!state.selectedEvaluationId) return false;

        try {
          const db = getDatabase();
          const { error } = await db.from('test_cases').delete().eq('id', id);

          if (error) return false;

          const newTestCases = state.testCases.filter(tc => tc.id !== id);
          set({ testCases: newTestCases });
          get().updateCache(state.selectedEvaluationId, { testCases: newTestCases });
          return true;
        } catch {
          return false;
        }
      },

      // Criteria
      addCriterion: async (criterion) => {
        const state = get();
        if (!state.selectedEvaluationId) return null;

        try {
          const db = getDatabase();
          const { data, error } = await db
            .from('evaluation_criteria')
            .insert({
              evaluation_id: state.selectedEvaluationId,
              ...criterion,
            })
            .select()
            .single();

          if (error || !data) return null;

          const newCriteria = [...state.criteria, data];
          set({ criteria: newCriteria });
          get().updateCache(state.selectedEvaluationId, { criteria: newCriteria });
          return data;
        } catch {
          return null;
        }
      },

      updateCriterion: async (criterion: EvaluationCriterion) => {
        const state = get();
        if (!state.selectedEvaluationId) return false;

        try {
          const db = getDatabase();
          const { error } = await db
            .from('evaluation_criteria')
            .update({
              name: criterion.name,
              description: criterion.description,
              prompt: criterion.prompt,
              weight: criterion.weight,
              enabled: criterion.enabled,
            })
            .eq('id', criterion.id);

          if (error) return false;

          const newCriteria = state.criteria.map(c =>
            c.id === criterion.id ? criterion : c
          );
          set({ criteria: newCriteria });
          get().updateCache(state.selectedEvaluationId, { criteria: newCriteria });
          return true;
        } catch {
          return false;
        }
      },

      deleteCriterion: async (id: string) => {
        const state = get();
        if (!state.selectedEvaluationId) return false;

        try {
          const db = getDatabase();
          const { error } = await db.from('evaluation_criteria').delete().eq('id', id);

          if (error) return false;

          const newCriteria = state.criteria.filter(c => c.id !== id);
          set({ criteria: newCriteria });
          get().updateCache(state.selectedEvaluationId, { criteria: newCriteria });
          return true;
        } catch {
          return false;
        }
      },

      // Run
      deleteRun: async (runId: string) => {
        const state = get();
        if (!state.selectedEvaluationId) return false;

        try {
          const db = getDatabase();

          // Delete results first
          await db.from('test_case_results').delete().eq('run_id', runId);
          // Delete run
          const { error } = await db.from('evaluation_runs').delete().eq('id', runId);

          if (error) return false;

          const newRuns = state.runs.filter(r => r.id !== runId);
          const newResults = state.selectedRunId === runId ? [] : state.results;
          let newSelectedRunId = state.selectedRunId;

          // If deleted run was selected, select another
          if (state.selectedRunId === runId) {
            const nextRun = newRuns.find(r => r.status === 'completed');
            newSelectedRunId = nextRun?.id || null;
            set({ runs: newRuns, selectedRunId: newSelectedRunId, results: [] });
            if (nextRun) {
              get().fetchRunResults(nextRun.id);
            }
          } else {
            set({ runs: newRuns });
          }

          // 更新缓存
          get().updateCache(state.selectedEvaluationId, {
            runs: newRuns,
            results: newResults,
            selectedRunId: newSelectedRunId,
          });

          return true;
        } catch {
          return false;
        }
      },

      incrementRunningCount: () => {
        set(s => ({ runningCount: s.runningCount + 1 }));
      },

      decrementRunningCount: () => {
        set(s => ({ runningCount: Math.max(0, s.runningCount - 1) }));
      },

      // Batch update for performance - key optimization!
      appendResults: (newResults: TestCaseResult[]) => {
        set(s => ({ results: [...s.results, ...newResults] }));
      },

      setResults: (results: TestCaseResult[]) => {
        const state = get();
        set({ results });
        if (state.selectedEvaluationId) {
          get().updateCache(state.selectedEvaluationId, { results });
        }
      },

      updateRuns: (runs: EvaluationRun[]) => {
        const state = get();
        set({ runs });
        if (state.selectedEvaluationId) {
          get().updateCache(state.selectedEvaluationId, { runs });
        }
      },

      // UI Actions
      setShowNewEval: (show) => set({ showNewEval: show }),
      setNewEvalName: (name) => set({ newEvalName: name }),
      setNewEvalPromptId: (id) => set({ newEvalPromptId: id }),
      setNewEvalModelId: (id) => set({ newEvalModelId: id }),
      setNewEvalJudgeModelId: (id) => set({ newEvalJudgeModelId: id }),
      setIsEditingName: (editing) => set({ isEditingName: editing }),
      setEditingName: (name) => set({ editingName: name }),

      // Cache management
      updateCache: (evaluationId: string, updates: Partial<EvaluationCache>) => {
        const state = get();
        const cached = state.cache.get(evaluationId);
        if (cached) {
          const newCache = new Map(state.cache);
          newCache.set(evaluationId, { ...cached, ...updates });
          set({ cache: newCache });
        }
      },

      clearCache: (evaluationId: string) => {
        const state = get();
        const newCache = new Map(state.cache);
        newCache.delete(evaluationId);
        set({ cache: newCache });
      },

      clearAllCache: () => {
        set({ cache: new Map(), listLoaded: false });
      },

      resetNewEvalForm: () => {
        set({
          newEvalName: '',
          newEvalPromptId: '',
          newEvalModelId: '',
          newEvalJudgeModelId: '',
        });
      },
    }),
    { name: 'evaluation-store' }
  )
);

// Selectors
export const useSelectedEvaluation = () => {
  const evaluations = useEvaluationStore(state => state.evaluations);
  const selectedEvaluationId = useEvaluationStore(state => state.selectedEvaluationId);
  return evaluations.find(e => e.id === selectedEvaluationId) || null;
};

export const useSelectedRun = () => {
  const runs = useEvaluationStore(state => state.runs);
  const selectedRunId = useEvaluationStore(state => state.selectedRunId);
  return runs.find(r => r.id === selectedRunId) || null;
};
