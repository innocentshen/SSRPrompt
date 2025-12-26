import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Plus,
  Play,
  BarChart3,
  Trash2,
  AlertCircle,
  Settings2,
  FileText,
  Loader2,
  History,
  Copy,
  Pencil,
  Check,
  X,
} from 'lucide-react';
import { Button, Input, Modal, Badge, Select, useToast, ModelSelector } from '../components/ui';
import { TestCaseList, CriteriaEditor, EvaluationResultsView, RunHistory } from '../components/Evaluation';
import { getDatabase, isDatabaseConfigured, getMySQLAdapter, getCurrentProvider } from '../lib/database';
import { callAIModel, type FileAttachment } from '../lib/ai-service';
import { getFileUploadCapabilities } from '../lib/model-capabilities';
import type {
  Evaluation,
  Prompt,
  Model,
  Provider,
  EvaluationStatus,
  TestCase,
  EvaluationCriterion,
  TestCaseResult,
  PromptVariable,
  EvaluationRun,
} from '../types';

const statusConfig: Record<EvaluationStatus, { labelKey: string; variant: 'info' | 'warning' | 'success' | 'error' }> = {
  pending: { labelKey: 'pending', variant: 'info' },
  running: { labelKey: 'running', variant: 'warning' },
  completed: { labelKey: 'completed', variant: 'success' },
  failed: { labelKey: 'failed', variant: 'error' },
};

type TabType = 'testcases' | 'criteria' | 'history' | 'results';

// 缓存数据类型（不包含附件的 base64 数据，避免内存过大）
interface EvaluationCacheData {
  testCases: TestCase[];
  criteria: EvaluationCriterion[];
  runs: EvaluationRun[];
  results: TestCaseResult[];
  selectedRunId: string | null;
}

// 使用内存缓存，不用 localStorage（附件数据太大）
const evaluationCache = new Map<string, EvaluationCacheData>();

// 列表缓存
interface ListCache {
  evaluations: Evaluation[];
  prompts: Prompt[];
  models: Model[];
  providers: Provider[];
}

let listCache: ListCache | null = null;
let listDataLoading = false;  // 全局加载状态，防止重复请求
const loadingEvaluations = new Set<string>();  // 正在加载的评测ID集合

export function EvaluationPage() {
  const { showToast } = useToast();
  const { t } = useTranslation('evaluation');
  const { t: tCommon } = useTranslation('common');
  const [evaluations, setEvaluations] = useState<Evaluation[]>([]);
  const [prompts, setPrompts] = useState<Prompt[]>([]);
  const [models, setModels] = useState<Model[]>([]);
  const [providers, setProviders] = useState<Provider[]>([]);
  const [selectedEvaluation, setSelectedEvaluation] = useState<Evaluation | null>(null);
  const [showNewEval, setShowNewEval] = useState(false);
  const [newEvalName, setNewEvalName] = useState('');
  const [newEvalPrompt, setNewEvalPrompt] = useState('');
  const [newEvalModel, setNewEvalModel] = useState('');
  const [newEvalJudgeModel, setNewEvalJudgeModel] = useState('');
  const [listLoading, setListLoading] = useState(true);
  const [detailsLoading, setDetailsLoading] = useState(false);

  const [activeTab, setActiveTab] = useState<TabType>('testcases');
  const [testCases, setTestCases] = useState<TestCase[]>([]);
  const [criteria, setCriteria] = useState<EvaluationCriterion[]>([]);
  const [results, setResults] = useState<TestCaseResult[]>([]);
  const [runs, setRuns] = useState<EvaluationRun[]>([]);
  const [selectedRun, setSelectedRun] = useState<EvaluationRun | null>(null);
  const [runningCount, setRunningCount] = useState(0);
  const [runningTestCaseId, setRunningTestCaseId] = useState<string | null>(null);
  const [isEditingName, setIsEditingName] = useState(false);
  const [editingName, setEditingName] = useState('');
  const abortControllersRef = useRef<Map<string, { aborted: boolean }>>(new Map());
  const selectedEvaluationIdRef = useRef<string | null>(null);

  // 同步 ref 以便在异步操作中访问最新的 selectedEvaluation
  useEffect(() => {
    selectedEvaluationIdRef.current = selectedEvaluation?.id || null;
  }, [selectedEvaluation]);

  // 计算当前评测模型的文件上传能力
  const fileUploadCapabilities = useMemo(() => {
    if (!selectedEvaluation?.model_id) {
      return { accept: '.txt,.md,.json,.csv,.xml,.yaml,.yml', canUploadImage: false, canUploadPdf: false, canUploadText: true };
    }
    const model = models.find((m) => m.id === selectedEvaluation.model_id);
    const provider = providers.find((p) => p.id === model?.provider_id);
    if (!model || !provider) {
      return { accept: '.txt,.md,.json,.csv,.xml,.yaml,.yml', canUploadImage: false, canUploadPdf: false, canUploadText: true };
    }
    return getFileUploadCapabilities(provider.type, model.model_id, model.supports_vision ?? true);
  }, [selectedEvaluation?.model_id, models, providers]);

  // 获取当前评测模型的信息用于传递给子组件
  const currentModelInfo = useMemo(() => {
    if (!selectedEvaluation?.model_id) {
      return { providerType: undefined, modelId: undefined, supportsVision: true };
    }
    const model = models.find((m) => m.id === selectedEvaluation.model_id);
    const provider = providers.find((p) => p.id === model?.provider_id);
    return {
      providerType: provider?.type,
      modelId: model?.model_id,
      supportsVision: model?.supports_vision ?? true,
    };
  }, [selectedEvaluation?.model_id, models, providers]);

  useEffect(() => {
    loadData();
  }, []);

  const loadEvaluationDetails = useCallback(async (evaluationId: string) => {
    // 检查缓存 - 有缓存直接使用
    const cached = evaluationCache.get(evaluationId);
    if (cached) {
      setDetailsLoading(false);
      setTestCases(cached.testCases);
      setCriteria(cached.criteria);
      setRuns(cached.runs);
      setResults(cached.results);
      setSelectedRun(cached.runs.find(r => r.id === cached.selectedRunId) || null);
      return;
    }

    // 如果正在加载这个评测，只需要显示加载状态，不重复发起请求
    if (loadingEvaluations.has(evaluationId)) {
      // 显示加载状态并清空旧数据
      setDetailsLoading(true);
      setTestCases([]);
      setCriteria([]);
      setRuns([]);
      setResults([]);
      setSelectedRun(null);
      return;
    }

    loadingEvaluations.add(evaluationId);
    setDetailsLoading(true);
    // 清空旧数据，避免显示上一个评测的内容
    setTestCases([]);
    setCriteria([]);
    setRuns([]);
    setResults([]);
    setSelectedRun(null);

    try {
      // 优先使用 MySQL 专用接口（一次请求获取所有数据）
      const mysqlAdapter = getMySQLAdapter();
      if (mysqlAdapter) {
        const { data, error } = await mysqlAdapter.getEvaluationDetails(evaluationId);
        if (error) {
          console.error('Failed to load evaluation details:', error);
          return;
        }
        if (data) {
          const loadedTestCases = (data.testCases || []).map(tc => ({
            ...tc,
            attachments: (tc.attachments as unknown[]) || [],
            notes: tc.notes || null,
          })) as TestCase[];
          const loadedCriteria = (data.criteria || []) as EvaluationCriterion[];
          const loadedRuns = (data.runs || []) as EvaluationRun[];
          const loadedResults = (data.results || []) as TestCaseResult[];
          const loadedSelectedRunId = data.latestCompletedRunId;

          // 存入缓存
          evaluationCache.set(evaluationId, {
            testCases: loadedTestCases,
            criteria: loadedCriteria,
            runs: loadedRuns,
            results: loadedResults,
            selectedRunId: loadedSelectedRunId,
          });

          // 只有当前选中的评测还是这个时才更新状态
          if (selectedEvaluationIdRef.current === evaluationId) {
            setTestCases(loadedTestCases);
            setCriteria(loadedCriteria);
            setRuns(loadedRuns);
            setResults(loadedResults);
            setSelectedRun(loadedRuns.find(r => r.id === loadedSelectedRunId) || null);
          }
          return;
        }
      }

      // 回退到标准查询（用于 Supabase）
      const db = getDatabase();
      const [testCasesRes, criteriaRes, runsRes] = await Promise.all([
        db
          .from('test_cases')
          .select('*')
          .eq('evaluation_id', evaluationId)
          .order('order_index'),
        db
          .from('evaluation_criteria')
          .select('*')
          .eq('evaluation_id', evaluationId)
          .order('created_at'),
        db
          .from('evaluation_runs')
          .select('*')
          .eq('evaluation_id', evaluationId)
          .order('created_at', { ascending: false }),
      ]);

      const loadedTestCases = (testCasesRes.data || []).map(tc => ({
        ...tc,
        attachments: tc.attachments || [],
        notes: tc.notes || null,
      }));
      const loadedCriteria = criteriaRes.data || [];
      const loadedRuns = runsRes.data || [];
      let loadedResults: TestCaseResult[] = [];
      let loadedSelectedRunId: string | null = null;

      if (loadedRuns.length > 0) {
        const latestCompletedRun = loadedRuns.find(r => r.status === 'completed');
        if (latestCompletedRun) {
          loadedSelectedRunId = latestCompletedRun.id;
          const resultsRes = await db
            .from('test_case_results')
            .select('*')
            .eq('run_id', latestCompletedRun.id)
            .order('created_at');
          loadedResults = resultsRes.data || [];
        }
      }

      // 存入缓存
      evaluationCache.set(evaluationId, {
        testCases: loadedTestCases,
        criteria: loadedCriteria,
        runs: loadedRuns,
        results: loadedResults,
        selectedRunId: loadedSelectedRunId,
      });

      // 只有当前选中的评测还是这个时才更新状态（解决问题1）
      if (selectedEvaluationIdRef.current === evaluationId) {
        setTestCases(loadedTestCases);
        setCriteria(loadedCriteria);
        setRuns(loadedRuns);
        setResults(loadedResults);
        setSelectedRun(loadedRuns.find(r => r.id === loadedSelectedRunId) || null);
      }
    } finally {
      // 移除加载标记
      loadingEvaluations.delete(evaluationId);
      // 只有当前选中的评测还是这个时才取消加载状态
      if (selectedEvaluationIdRef.current === evaluationId) {
        setDetailsLoading(false);
      }
    }
  }, []);

  // 只在 selectedEvaluation.id 变化时重新加载，避免 status 变化触发重载覆盖数据
  const selectedEvaluationId = selectedEvaluation?.id;
  useEffect(() => {
    if (selectedEvaluationId) {
      loadEvaluationDetails(selectedEvaluationId);
    } else {
      setTestCases([]);
      setCriteria([]);
      setResults([]);
      setRuns([]);
      setSelectedRun(null);
    }
  }, [selectedEvaluationId, loadEvaluationDetails]);

  const loadData = async () => {
    // 检查数据库是否已配置
    if (!isDatabaseConfigured()) {
      setListLoading(false);
      return;
    }

    // 如果有缓存，先使用缓存
    if (listCache) {
      setEvaluations(listCache.evaluations);
      setPrompts(listCache.prompts);
      setModels(listCache.models);
      setProviders(listCache.providers);
      if (listCache.evaluations.length > 0 && !selectedEvaluation) {
        setSelectedEvaluation(listCache.evaluations[0]);
      }
      setListLoading(false);
      return;
    }

    setListLoading(true);
    try {
      // 优先使用 MySQL 批量查询（一次请求获取所有数据）
      const mysqlAdapter = getMySQLAdapter();
      if (mysqlAdapter) {
        const { data, error } = await mysqlAdapter.batchQuery<{
          evaluations: Evaluation[];
          prompts: Prompt[];
          models: Model[];
          providers: Provider[];
        }>([
          {
            key: 'evaluations',
            table: 'evaluations',
            columns: 'id, name, prompt_id, model_id, judge_model_id, status, config, results, created_at, completed_at',
            orderBy: [{ column: 'created_at', ascending: false }],
          },
          {
            key: 'prompts',
            table: 'prompts',
            columns: 'id, name, content, variables, current_version',
          },
          {
            key: 'models',
            table: 'models',
            columns: 'id, name, provider_id, model_id',
          },
          {
            key: 'providers',
            table: 'providers',
            columns: 'id, name, enabled, type, api_key, base_url',
            filters: [{ column: 'enabled', operator: '=', value: true }],
          },
        ]);

        if (!error && data) {
          const loadedEvaluations = data.evaluations || [];
          const loadedPrompts = data.prompts || [];
          const loadedModels = data.models || [];
          const loadedProviders = data.providers || [];

          // 保存到缓存
          listCache = {
            evaluations: loadedEvaluations,
            prompts: loadedPrompts,
            models: loadedModels,
            providers: loadedProviders,
          };

          setEvaluations(loadedEvaluations);
          setPrompts(loadedPrompts);
          setModels(loadedModels);
          setProviders(loadedProviders);

          if (loadedEvaluations.length > 0 && !selectedEvaluation) {
            setSelectedEvaluation(loadedEvaluations[0]);
          }
          return;
        }
      }

      // 回退到标准查询（用于 Supabase）
      const db = getDatabase();
      const [evalsRes, promptsRes, modelsRes, providersRes] = await Promise.all([
        db.from('evaluations').select('*').order('created_at', { ascending: false }),
        db.from('prompts').select('*'),
        db.from('models').select('*'),
        db.from('providers').select('*').eq('enabled', true),
      ]);

      const loadedEvaluations = evalsRes.data || [];
      const loadedPrompts = promptsRes.data || [];
      const loadedModels = modelsRes.data || [];
      const loadedProviders = providersRes.data || [];

      // 保存到缓存
      listCache = {
        evaluations: loadedEvaluations,
        prompts: loadedPrompts,
        models: loadedModels,
        providers: loadedProviders,
      };

      setEvaluations(loadedEvaluations);
      setPrompts(loadedPrompts);
      setModels(loadedModels);
      setProviders(loadedProviders);

      if (loadedEvaluations.length > 0 && !selectedEvaluation) {
        setSelectedEvaluation(loadedEvaluations[0]);
      }
    } finally {
      setListLoading(false);
    }
  };

  // 更新缓存的辅助函数
  const updateEvaluationCache = (evaluationId: string, updates: Partial<EvaluationCacheData>) => {
    const cached = evaluationCache.get(evaluationId);
    if (cached) {
      evaluationCache.set(evaluationId, { ...cached, ...updates });
    }
  };

  // 清除缓存
  const clearEvaluationCache = (evaluationId: string) => {
    evaluationCache.delete(evaluationId);
  };

  // 更新列表缓存
  const updateListCache = (updates: Partial<ListCache>) => {
    if (listCache) {
      listCache = { ...listCache, ...updates };
    }
  };

  const handleCreateEvaluation = async () => {
    if (!newEvalName.trim()) return;
    try {
      const { data, error } = await getDatabase()
        .from('evaluations')
        .insert({
          name: newEvalName.trim(),
          prompt_id: newEvalPrompt || null,
          model_id: newEvalModel || null,
          judge_model_id: newEvalJudgeModel || null,
          status: 'pending',
          config: { pass_threshold: 0.6 },
          results: {},
        })
        .select()
        .single();

      if (error) {
        showToast('error', t('createFailed') + ': ' + error.message);
        return;
      }

      if (data) {
        const newEvaluations = [data, ...evaluations];
        updateListCache({ evaluations: newEvaluations });
        setEvaluations(newEvaluations);
        setSelectedEvaluation(data);
        setNewEvalName('');
        setNewEvalPrompt('');
        setNewEvalModel('');
        setNewEvalJudgeModel('');
        setShowNewEval(false);
        showToast('success', t('evaluationCreated'));
      }
    } catch {
      showToast('error', t('createEvaluationFailed'));
    }
  };

  const handleAddTestCase = async () => {
    if (!selectedEvaluation) return;

    const newTestCase: Omit<TestCase, 'id' | 'created_at'> = {
      evaluation_id: selectedEvaluation.id,
      name: '',
      input_text: '',
      input_variables: {},
      attachments: [],
      expected_output: null,
      order_index: testCases.length,
    };

    const { data, error } = await getDatabase()
      .from('test_cases')
      .insert(newTestCase)
      .select()
      .single();

    if (error) {
      showToast('error', t('addFailed') + ': ' + error.message);
      return;
    }

    if (data) {
      const newTestCases = [...testCases, data];
      setTestCases(newTestCases);
      updateEvaluationCache(selectedEvaluation.id, { testCases: newTestCases });
    }
  };

  const handleUpdateTestCase = async (testCase: TestCase) => {
    if (!selectedEvaluation) return;

    const { error } = await getDatabase()
      .from('test_cases')
      .update({
        name: testCase.name,
        input_text: testCase.input_text,
        input_variables: testCase.input_variables,
        attachments: testCase.attachments,
        expected_output: testCase.expected_output,
        order_index: testCase.order_index,
      })
      .eq('id', testCase.id);

    if (error) {
      showToast('error', t('updateFailed') + ': ' + error.message);
      return;
    }

    const newTestCases = testCases.map((tc) => (tc.id === testCase.id ? testCase : tc));
    setTestCases(newTestCases);
    updateEvaluationCache(selectedEvaluation.id, { testCases: newTestCases });
  };

  const handleDeleteTestCase = async (id: string) => {
    if (!selectedEvaluation) return;

    const { error } = await getDatabase().from('test_cases').delete().eq('id', id);
    if (error) {
      showToast('error', t('deleteFailed') + ': ' + error.message);
      return;
    }
    const newTestCases = testCases.filter((tc) => tc.id !== id);
    setTestCases(newTestCases);
    updateEvaluationCache(selectedEvaluation.id, { testCases: newTestCases });
  };

  const handleAddCriterion = async (
    criterion: Omit<EvaluationCriterion, 'id' | 'evaluation_id' | 'created_at'>
  ) => {
    if (!selectedEvaluation) return;

    const { data, error } = await getDatabase()
      .from('evaluation_criteria')
      .insert({
        evaluation_id: selectedEvaluation.id,
        ...criterion,
      })
      .select()
      .single();

    if (error) {
      showToast('error', t('addFailed') + ': ' + error.message);
      return;
    }

    if (data) {
      const newCriteria = [...criteria, data];
      setCriteria(newCriteria);
      updateEvaluationCache(selectedEvaluation.id, { criteria: newCriteria });
    }
  };

  const handleUpdateCriterion = async (criterion: EvaluationCriterion) => {
    if (!selectedEvaluation) return;

    const { error } = await getDatabase()
      .from('evaluation_criteria')
      .update({
        name: criterion.name,
        description: criterion.description,
        prompt: criterion.prompt,
        weight: criterion.weight,
        enabled: criterion.enabled,
      })
      .eq('id', criterion.id);

    if (error) {
      showToast('error', t('updateFailed') + ': ' + error.message);
      return;
    }

    const newCriteria = criteria.map((c) => (c.id === criterion.id ? criterion : c));
    setCriteria(newCriteria);
    updateEvaluationCache(selectedEvaluation.id, { criteria: newCriteria });
  };

  const handleDeleteCriterion = async (id: string) => {
    if (!selectedEvaluation) return;

    const { error } = await getDatabase().from('evaluation_criteria').delete().eq('id', id);
    if (error) {
      showToast('error', t('deleteFailed') + ': ' + error.message);
      return;
    }
    const newCriteria = criteria.filter((c) => c.id !== id);
    setCriteria(newCriteria);
    updateEvaluationCache(selectedEvaluation.id, { criteria: newCriteria });
  };

  const handleSelectRun = async (run: EvaluationRun) => {
    if (!selectedEvaluation) return;

    setSelectedRun(run);
    const resultsRes = await getDatabase()
      .from('test_case_results')
      .select('*')
      .eq('run_id', run.id)
      .order('created_at');
    if (resultsRes.data) {
      setResults(resultsRes.data);
      updateEvaluationCache(selectedEvaluation.id, { results: resultsRes.data, selectedRunId: run.id });
    }
    setActiveTab('results');
  };

  const runEvaluation = async () => {
    if (!selectedEvaluation) return;
    if (testCases.length === 0) {
      showToast('error', t('addTestCasesFirst'));
      return;
    }
    if (!selectedEvaluation.model_id) {
      showToast('error', t('selectModelFirst'));
      return;
    }

    const model = models.find((m) => m.id === selectedEvaluation.model_id);
    const provider = providers.find((p) => p.id === model?.provider_id);
    const prompt = prompts.find((p) => p.id === selectedEvaluation.prompt_id);

    if (!model || !provider) {
      showToast('error', t('modelOrProviderNotFound'));
      return;
    }

    const evalId = selectedEvaluation.id;
    const evalConfig = selectedEvaluation.config;
    const judgeModelId = selectedEvaluation.judge_model_id;
    const currentTestCases = [...testCases];
    const enabledCriteria = criteria.filter((c) => c.enabled);

    showToast('info', t('evaluationStarted'));
    setActiveTab('history');
    setRunningCount(prev => prev + 1);

    const { data: runData, error: runError } = await getDatabase()
      .from('evaluation_runs')
      .insert({
        evaluation_id: evalId,
        status: 'running',
        results: {},
      })
      .select()
      .single();

    if (runError || !runData) {
      showToast('error', t('createExecutionRecordFailed'));
      setRunningCount(prev => Math.max(0, prev - 1));
      return;
    }

    const currentRun = runData as EvaluationRun;
    // 更新状态并同步更新缓存，避免缓存数据覆盖新 run
    setRuns(prev => {
      const newRuns = [currentRun, ...prev];
      // 同步更新缓存
      const cached = evaluationCache.get(evalId);
      if (cached) {
        evaluationCache.set(evalId, { ...cached, runs: newRuns });
      }
      return newRuns;
    });
    setSelectedRun(currentRun);

    const abortController = { aborted: false };
    abortControllersRef.current.set(currentRun.id, abortController);

    await getDatabase()
      .from('evaluations')
      .update({ status: 'running' })
      .eq('id', evalId);

    setSelectedEvaluation((prev) => prev?.id === evalId ? { ...prev, status: 'running' } : prev);
    setEvaluations((prev) =>
      prev.map((e) =>
        e.id === evalId ? { ...e, status: 'running' as EvaluationStatus } : e
      )
    );

    (async () => {
      const newResults: TestCaseResult[] = [];
      const allScores: Record<string, number[]> = {};

      for (const testCase of currentTestCases) {
        if (abortController.aborted) {
          break;
        }
        try {
          let systemPrompt = '';
          let userMessage = '';

          if (prompt) {
            systemPrompt = prompt.content;
            const vars = { ...testCase.input_variables };

            for (const [key, value] of Object.entries(vars)) {
              systemPrompt = systemPrompt.replace(new RegExp(`{{${key}}}`, 'g'), value);
            }

            if (systemPrompt.includes('{{input}}')) {
              systemPrompt = systemPrompt.replace(/{{input}}/g, testCase.input_text || '');
            } else {
              userMessage = testCase.input_text || '';
            }
          } else {
            userMessage = testCase.input_text || '';
          }

          const finalPrompt = userMessage ? `${systemPrompt}\n\n${userMessage}`.trim() : systemPrompt;

          const files: FileAttachment[] = testCase.attachments.map((a) => ({
            name: a.name,
            type: a.type,
            base64: a.base64,
          }));

          const aiResponse = await callAIModel(
            provider,
            model.model_id,
            finalPrompt,
            undefined,
            files.length > 0 ? files : undefined
          );

          const scores: Record<string, number> = {};
          const aiFeedback: Record<string, string> = {};

          if (enabledCriteria.length > 0 && judgeModelId) {
            const judgeModel = models.find((m) => m.id === judgeModelId);
            const judgeProvider = providers.find((p) => p.id === judgeModel?.provider_id);

            if (judgeModel && judgeProvider) {
              for (const criterion of enabledCriteria) {
                try {
                  let evalPrompt = criterion.prompt;
                  evalPrompt = evalPrompt.replace(/{{input}}/g, testCase.input_text || '');
                  evalPrompt = evalPrompt.replace(/{{output}}/g, aiResponse.content);
                  if (testCase.expected_output) {
                    evalPrompt = evalPrompt.replace(/{{#expected}}[\s\S]*?{{\/expected}}/g,
                      evalPrompt.match(/{{#expected}}([\s\S]*?){{\/expected}}/)?.[1]?.replace(/{{expected}}/g, testCase.expected_output) || ''
                    );
                    evalPrompt = evalPrompt.replace(/{{expected}}/g, testCase.expected_output);
                  } else {
                    evalPrompt = evalPrompt.replace(/{{#expected}}[\s\S]*?{{\/expected}}/g, '');
                  }

                  const evalResponse = await callAIModel(
                    judgeProvider,
                    judgeModel.model_id,
                    evalPrompt
                  );

                  const jsonMatch = evalResponse.content.match(/\{[\s\S]*?"score"[\s\S]*?\}/);
                  if (jsonMatch) {
                    const parsed = JSON.parse(jsonMatch[0]);
                    const score = Math.min(1, Math.max(0, (parsed.score || 0) / 10));
                    scores[criterion.name] = score;
                    aiFeedback[criterion.name] = parsed.reason || '';

                    if (!allScores[criterion.name]) allScores[criterion.name] = [];
                    allScores[criterion.name].push(score);
                  }
                } catch {
                  scores[criterion.name] = 0;
                  aiFeedback[criterion.name] = t('evaluationFailed');
                }
              }
            }
          }

          const avgScore = Object.keys(scores).length > 0
            ? Object.keys(scores).reduce((sum, name) => {
                const criterion = enabledCriteria.find(c => c.name === name);
                return sum + scores[name] * (criterion?.weight || 1);
              }, 0) / enabledCriteria.reduce((sum, c) => sum + c.weight, 0)
            : 1;
          const passed = avgScore >= (evalConfig.pass_threshold || 0.6);

          const result: Omit<TestCaseResult, 'id' | 'created_at'> = {
            evaluation_id: evalId,
            test_case_id: testCase.id,
            run_id: currentRun.id,
            model_output: aiResponse.content,
            scores,
            ai_feedback: aiFeedback,
            latency_ms: aiResponse.latencyMs,
            tokens_input: aiResponse.tokensInput,
            tokens_output: aiResponse.tokensOutput,
            passed,
            error_message: null,
          };

          const { data } = await getDatabase()
            .from('test_case_results')
            .insert(result)
            .select()
            .single();

          if (data) {
            newResults.push(data);
            setResults((prev) => [...prev, data]);
          }
        } catch (err) {
          const result: Omit<TestCaseResult, 'id' | 'created_at'> = {
            evaluation_id: evalId,
            test_case_id: testCase.id,
            run_id: currentRun.id,
            model_output: '',
            scores: {},
            ai_feedback: {},
            latency_ms: 0,
            tokens_input: 0,
            tokens_output: 0,
            passed: false,
            error_message: err instanceof Error ? err.message : t('unknownError'),
          };

          const { data } = await getDatabase()
            .from('test_case_results')
            .insert(result)
            .select()
            .single();

          if (data) {
            newResults.push(data);
            setResults((prev) => [...prev, data]);
          }
        }
      }

      const overallScores: Record<string, number> = {};
      for (const [name, scoreList] of Object.entries(allScores)) {
        overallScores[name] = scoreList.reduce((a, b) => a + b, 0) / scoreList.length;
      }

      if (abortController.aborted) {
        abortControllersRef.current.delete(currentRun.id);
        return;
      }

      const passedCount = newResults.filter((r) => r.passed).length;
      const totalTokensInput = newResults.reduce((sum, r) => sum + r.tokens_input, 0);
      const totalTokensOutput = newResults.reduce((sum, r) => sum + r.tokens_output, 0);
      const evalResults = {
        scores: overallScores,
        total_cases: currentTestCases.length,
        passed_cases: passedCount,
        summary: t('summaryTemplate', { total: currentTestCases.length, passed: passedCount, rate: ((passedCount / currentTestCases.length) * 100).toFixed(0) }),
      };

      await getDatabase()
        .from('evaluation_runs')
        .update({
          status: 'completed',
          results: evalResults,
          total_tokens_input: totalTokensInput,
          total_tokens_output: totalTokensOutput,
          completed_at: new Date().toISOString(),
        })
        .eq('id', currentRun.id);

      setRuns(prev => prev.map(r =>
        r.id === currentRun.id
          ? { ...r, status: 'completed' as EvaluationStatus, results: evalResults, total_tokens_input: totalTokensInput, total_tokens_output: totalTokensOutput, completed_at: new Date().toISOString() }
          : r
      ));
      setSelectedRun(prev =>
        prev?.id === currentRun.id
          ? { ...prev, status: 'completed', results: evalResults, total_tokens_input: totalTokensInput, total_tokens_output: totalTokensOutput, completed_at: new Date().toISOString() }
          : prev
      );

      await getDatabase()
        .from('evaluations')
        .update({
          status: 'completed',
          results: evalResults,
          completed_at: new Date().toISOString(),
        })
        .eq('id', evalId);

      setSelectedEvaluation((prev) =>
        prev?.id === evalId ? { ...prev, status: 'completed', results: evalResults } : prev
      );
      setEvaluations((prev) =>
        prev.map((e) =>
          e.id === evalId
            ? { ...e, status: 'completed' as EvaluationStatus, results: evalResults }
            : e
        )
      );

      // 清除缓存，确保下次加载时获取最新数据
      clearEvaluationCache(evalId);

      abortControllersRef.current.delete(currentRun.id);
      setRunningCount(prev => Math.max(0, prev - 1));
      showToast('success', t('evaluationComplete'));
    })();
  };

  // 单用例评测
  const handleRunSingleTestCase = async (testCase: TestCase) => {
    if (!selectedEvaluation) return;
    if (!selectedEvaluation.model_id) {
      showToast('error', t('selectModelFirst'));
      return;
    }

    const model = models.find((m) => m.id === selectedEvaluation.model_id);
    const provider = providers.find((p) => p.id === model?.provider_id);
    const prompt = prompts.find((p) => p.id === selectedEvaluation.prompt_id);

    if (!model || !provider) {
      showToast('error', t('modelOrProviderNotFound'));
      return;
    }

    const evalId = selectedEvaluation.id;
    const evalConfig = selectedEvaluation.config;
    const judgeModelId = selectedEvaluation.judge_model_id;
    const enabledCriteria = criteria.filter((c) => c.enabled);

    setRunningTestCaseId(testCase.id);

    // 创建执行记录
    const { data: runData, error: runError } = await getDatabase()
      .from('evaluation_runs')
      .insert({
        evaluation_id: evalId,
        status: 'running',
        results: {},
      })
      .select()
      .single();

    if (runError || !runData) {
      showToast('error', t('createExecutionRecordFailed'));
      setRunningTestCaseId(null);
      return;
    }

    const currentRun = runData as EvaluationRun;
    // 更新状态并同步更新缓存
    setRuns(prev => {
      const newRuns = [currentRun, ...prev];
      const cached = evaluationCache.get(evalId);
      if (cached) {
        evaluationCache.set(evalId, { ...cached, runs: newRuns });
      }
      return newRuns;
    });

    try {
      let systemPrompt = '';
      let userMessage = '';

      if (prompt) {
        systemPrompt = prompt.content || '';
        const vars = { ...testCase.input_variables };

        for (const [key, value] of Object.entries(vars)) {
          systemPrompt = systemPrompt.replace(new RegExp(`{{${key}}}`, 'g'), value);
        }

        if (systemPrompt.includes('{{input}}')) {
          systemPrompt = systemPrompt.replace(/{{input}}/g, testCase.input_text || '');
        } else {
          userMessage = testCase.input_text || '';
        }
      } else {
        userMessage = testCase.input_text || '';
      }

      const finalPrompt = userMessage ? `${systemPrompt}\n\n${userMessage}`.trim() : systemPrompt;

      const files: FileAttachment[] = testCase.attachments.map((a) => ({
        name: a.name,
        type: a.type,
        base64: a.base64,
      }));

      const startTime = Date.now();
      const aiResult = await callAIModel(
        provider,
        model.model_id,
        finalPrompt,
        undefined,
        files.length > 0 ? files : undefined
      );

      const latency = Date.now() - startTime;
      let scores: Record<string, number> = {};
      let aiFeedback: Record<string, string> = {};
      let passed = true;

      // AI 评判
      if (enabledCriteria.length > 0 && judgeModelId) {
        const judgeModel = models.find((m) => m.id === judgeModelId);
        const judgeProvider = providers.find((p) => p.id === judgeModel?.provider_id);

        if (judgeModel && judgeProvider) {
          for (const criterion of enabledCriteria) {
            const criterionDescription = criterion.description ? t('judgeDescriptionPrefix') + criterion.description : '';
            const criterionPrompt = criterion.prompt ? t('judgePromptPrefix') + criterion.prompt : '';
            const expectedOutput = testCase.expected_output ? t('judgeExpectedOutputPrefix') + testCase.expected_output : '';

            const judgePrompt = t('judgePromptTemplate', {
              criterionName: criterion.name,
              criterionDescription,
              criterionPrompt,
              userInput: testCase.input_text,
              modelOutput: aiResult.content,
              expectedOutput,
            });

            try {
              const judgeResult = await callAIModel(
                judgeProvider,
                judgeModel.model_id,
                judgePrompt
              );

              const scorePattern = t('judgeScorePattern');
              const reasonPattern = t('judgeReasonPattern');
              const scoreRegex = new RegExp(`${scorePattern}[：:]\\s*(\\d+(?:\\.\\d+)?)`);
              const reasonRegex = new RegExp(`${reasonPattern}[：:]\\s*(.+?)(?:\\n|$)`, 's');

              const scoreMatch = judgeResult.content.match(scoreRegex);
              const reasonMatch = judgeResult.content.match(reasonRegex);

              if (scoreMatch) {
                const score = Math.min(10, Math.max(0, parseFloat(scoreMatch[1]))) / 10;
                scores[criterion.name] = score;
                if (reasonMatch) {
                  aiFeedback[criterion.name] = reasonMatch[1].trim();
                }
              }
            } catch (error) {
              console.error('Judge error:', error);
            }
          }

          // 判断是否通过
          const passThreshold = (evalConfig?.passThreshold || 6) / 10;
          const avgScore =
            Object.values(scores).length > 0
              ? Object.values(scores).reduce((a, b) => a + b, 0) / Object.values(scores).length
              : 1;
          passed = avgScore >= passThreshold;
        }
      }

      // 保存结果
      const resultData = {
        evaluation_id: evalId,
        test_case_id: testCase.id,
        run_id: currentRun.id,
        model_output: aiResult.content,
        scores,
        ai_feedback: aiFeedback,
        latency_ms: latency,
        tokens_input: aiResult.tokensInput || 0,
        tokens_output: aiResult.tokensOutput || 0,
        passed,
      };

      const { data: savedResult } = await getDatabase()
        .from('test_case_results')
        .insert(resultData)
        .select()
        .single();

      const newResults = savedResult ? [savedResult as TestCaseResult] : [];

      // 计算总分
      const overallScores: Record<string, number> = {};
      for (const criterion of enabledCriteria) {
        if (scores[criterion.name] !== undefined) {
          overallScores[criterion.name] = scores[criterion.name];
        }
      }

      const evalResults = {
        passedCount: passed ? 1 : 0,
        totalCount: 1,
        overallScores,
        summary: t('singleTestComplete') + ', ' + (passed ? t('passed') : t('notPassed')),
      };

      // 更新运行记录
      await getDatabase()
        .from('evaluation_runs')
        .update({
          status: 'completed',
          results: evalResults,
          total_tokens_input: aiResult.tokensInput || 0,
          total_tokens_output: aiResult.tokensOutput || 0,
          completed_at: new Date().toISOString(),
        })
        .eq('id', currentRun.id);

      const completedRun: EvaluationRun = {
        ...currentRun,
        status: 'completed',
        results: evalResults,
        total_tokens_input: aiResult.tokensInput || 0,
        total_tokens_output: aiResult.tokensOutput || 0,
        completed_at: new Date().toISOString(),
      };

      setRuns(prev => {
        const newRuns = prev.map(r => r.id === currentRun.id ? completedRun : r);
        const cached = evaluationCache.get(evalId);
        if (cached) {
          evaluationCache.set(evalId, { ...cached, runs: newRuns });
        }
        return newRuns;
      });
      setResults(newResults);
      setSelectedRun(completedRun);
      setActiveTab('results');

      showToast('success', t('singleTestComplete') + ', ' + (passed ? t('passed') : t('notPassed')));
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : t('evaluationExecutionFailed');

      // 保存错误结果
      const errorResult = {
        evaluation_id: evalId,
        test_case_id: testCase.id,
        run_id: currentRun.id,
        model_output: '',
        scores: {},
        ai_feedback: {},
        latency_ms: 0,
        tokens_input: 0,
        tokens_output: 0,
        passed: false,
        error_message: errorMessage,
      };

      await getDatabase().from('test_case_results').insert(errorResult);

      await getDatabase()
        .from('evaluation_runs')
        .update({
          status: 'failed',
          error_message: errorMessage,
          completed_at: new Date().toISOString(),
        })
        .eq('id', currentRun.id);

      const failedRun: EvaluationRun = {
        ...currentRun,
        status: 'failed',
        error_message: errorMessage,
        completed_at: new Date().toISOString(),
      };

      setRuns(prev => {
        const newRuns = prev.map(r => r.id === currentRun.id ? failedRun : r);
        const cached = evaluationCache.get(evalId);
        if (cached) {
          evaluationCache.set(evalId, { ...cached, runs: newRuns });
        }
        return newRuns;
      });

      showToast('error', errorMessage);
    } finally {
      setRunningTestCaseId(null);
    }
  };

  const handleStopRun = async (runId: string) => {
    const controller = abortControllersRef.current.get(runId);
    if (controller) {
      controller.aborted = true;
      abortControllersRef.current.delete(runId);
    }

    const run = runs.find(r => r.id === runId);
    if (!run) return;

    const errorMessage = t('evaluationAborted');

    await getDatabase()
      .from('evaluation_runs')
      .update({
        status: 'failed',
        error_message: errorMessage,
        completed_at: new Date().toISOString(),
      })
      .eq('id', runId);

    await getDatabase()
      .from('evaluations')
      .update({
        status: 'failed',
      })
      .eq('id', run.evaluation_id);

    setRuns(prev => prev.map(r =>
      r.id === runId
        ? { ...r, status: 'failed' as EvaluationStatus, error_message: errorMessage, completed_at: new Date().toISOString() }
        : r
    ));

    setSelectedRun(prev =>
      prev?.id === runId
        ? { ...prev, status: 'failed', error_message: errorMessage, completed_at: new Date().toISOString() }
        : prev
    );

    if (selectedEvaluation?.id === run.evaluation_id) {
      setSelectedEvaluation(prev => prev ? { ...prev, status: 'failed' } : prev);
    }
    setEvaluations(prev =>
      prev.map((e) => (e.id === run.evaluation_id ? { ...e, status: 'failed' as EvaluationStatus } : e))
    );

    if (controller) {
      setRunningCount(prev => Math.max(0, prev - 1));
    }

    // 清除缓存
    clearEvaluationCache(run.evaluation_id);

    showToast('info', t('evaluationStopped'));
  };

  const handleDeleteRun = async (runId: string) => {
    if (!selectedEvaluation) return;

    try {
      // First delete related test case results
      await getDatabase().from('test_case_results').delete().eq('run_id', runId);

      // Then delete the run itself
      const { error } = await getDatabase().from('evaluation_runs').delete().eq('id', runId);
      if (error) {
        showToast('error', t('deleteFailed'));
        return;
      }

      const newRuns = runs.filter((r) => r.id !== runId);
      const newResults = results.filter((r) => r.run_id !== runId);

      setRuns(newRuns);
      setResults(newResults);

      if (selectedRun?.id === runId) {
        setSelectedRun(newRuns[0] || null);
      }

      // 更新缓存
      updateEvaluationCache(selectedEvaluation.id, {
        runs: newRuns,
        results: newResults,
        selectedRunId: selectedRun?.id === runId ? (newRuns[0]?.id || null) : selectedRun?.id || null,
      });

      showToast('success', t('executionRecordDeleted'));
    } catch {
      showToast('error', t('deleteExecutionRecordFailed'));
    }
  };

  const handleDeleteEvaluation = async () => {
    if (!selectedEvaluation) return;
    try {
      const evalIdToDelete = selectedEvaluation.id;
      const { error } = await getDatabase().from('evaluations').delete().eq('id', evalIdToDelete);
      if (error) {
        showToast('error', t('deleteFailed') + ': ' + error.message);
        return;
      }

      // 清除缓存
      clearEvaluationCache(evalIdToDelete);

      const remaining = evaluations.filter((e) => e.id !== evalIdToDelete);
      updateListCache({ evaluations: remaining });
      setEvaluations(remaining);
      setSelectedEvaluation(remaining[0] || null);
      showToast('success', t('evaluationDeleted'));
    } catch {
      showToast('error', t('deleteEvaluationFailed'));
    }
  };

  const handleCopyEvaluation = async () => {
    if (!selectedEvaluation) return;
    try {
      const { data: newEval, error: evalError } = await getDatabase()
        .from('evaluations')
        .insert({
          name: `${selectedEvaluation.name} (副本)`,
          prompt_id: selectedEvaluation.prompt_id,
          model_id: selectedEvaluation.model_id,
          judge_model_id: selectedEvaluation.judge_model_id,
          status: 'pending',
          config: selectedEvaluation.config,
          results: {},
        })
        .select()
        .single();

      if (evalError || !newEval) {
        showToast('error', t('copyEvaluationFailed') + ': ' + (evalError?.message || t('unknownError')));
        return;
      }

      const copyPromises = [];

      if (testCases.length > 0) {
        const newTestCases = testCases.map((tc) => ({
          evaluation_id: newEval.id,
          name: tc.name,
          input_text: tc.input_text,
          input_variables: tc.input_variables,
          attachments: tc.attachments,
          expected_output: tc.expected_output,
          order_index: tc.order_index,
        }));

        copyPromises.push(
          getDatabase()
            .from('test_cases')
            .insert(newTestCases)
            .then(({ error }) => {
              if (error) throw new Error(t('copyTestCaseFailed') + ': ' + error.message);
            })
        );
      }

      if (criteria.length > 0) {
        const newCriteria = criteria.map((c) => ({
          evaluation_id: newEval.id,
          name: c.name,
          description: c.description,
          prompt: c.prompt,
          weight: c.weight,
          enabled: c.enabled,
        }));

        copyPromises.push(
          getDatabase()
            .from('evaluation_criteria')
            .insert(newCriteria)
            .then(({ error }) => {
              if (error) throw new Error(t('copyCriteriaFailed') + ': ' + error.message);
            })
        );
      }

      await Promise.all(copyPromises);

      setEvaluations((prev) => [newEval, ...prev]);
      setSelectedEvaluation(newEval);
      showToast('success', t('evaluationCopied'));
    } catch (err) {
      showToast('error', err instanceof Error ? err.message : t('copyEvaluationFailed'));
    }
  };

  const handleUpdateEvaluation = async (field: string, value: string | null) => {
    if (!selectedEvaluation) return;

    const { error } = await getDatabase()
      .from('evaluations')
      .update({ [field]: value })
      .eq('id', selectedEvaluation.id);

    if (error) {
      showToast('error', t('updateFailed') + ': ' + error.message);
      return;
    }

    setSelectedEvaluation((prev) => prev ? { ...prev, [field]: value } : null);
    setEvaluations((prev) =>
      prev.map((e) => (e.id === selectedEvaluation.id ? { ...e, [field]: value } : e))
    );
  };

  const handleUpdateConfig = async (key: string, value: number) => {
    if (!selectedEvaluation) return;

    const newConfig = { ...selectedEvaluation.config, [key]: value };

    const { error } = await getDatabase()
      .from('evaluations')
      .update({ config: newConfig })
      .eq('id', selectedEvaluation.id);

    if (error) {
      showToast('error', t('updateFailed') + ': ' + error.message);
      return;
    }

    setSelectedEvaluation((prev) => prev ? { ...prev, config: newConfig } : null);
    setEvaluations((prev) =>
      prev.map((e) => (e.id === selectedEvaluation.id ? { ...e, config: newConfig } : e))
    );
  };

  const startEditingName = () => {
    if (selectedEvaluation) {
      setEditingName(selectedEvaluation.name);
      setIsEditingName(true);
    }
  };

  const cancelEditingName = () => {
    setIsEditingName(false);
    setEditingName('');
  };

  const saveEvaluationName = async () => {
    if (!selectedEvaluation || !editingName.trim()) {
      showToast('error', t('nameCannotBeEmpty'));
      return;
    }

    await handleUpdateEvaluation('name', editingName.trim());
    setIsEditingName(false);
    setEditingName('');
  };

  const enabledModels = models.filter((m) => {
    const provider = providers.find((p) => p.id === m.provider_id);
    return provider?.enabled;
  });

  const getPromptName = (id: string | null) => prompts.find((p) => p.id === id)?.name || '-';
  const getModelName = (id: string | null) => models.find((m) => m.id === id)?.name || '-';

  const selectedPrompt = prompts.find((p) => p.id === selectedEvaluation?.prompt_id);
  const promptVariables = (selectedPrompt?.variables as PromptVariable[] | undefined)?.map((v) => v.name) || [];

  return (
    <div className="h-full flex overflow-hidden bg-slate-950 light:bg-slate-50">
      <div className="w-80 bg-slate-900/50 light:bg-white border-r border-slate-700 light:border-slate-200 flex flex-col overflow-hidden">
        <div className="p-4 border-b border-slate-700 light:border-slate-200 flex-shrink-0">
          <Button className="w-full" onClick={() => setShowNewEval(true)}>
            <Plus className="w-4 h-4" />
            <span>{t('newEvaluation')}</span>
          </Button>
        </div>

        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {listLoading ? (
            <div className="space-y-2 p-2">
              {[1, 2, 3, 4].map((i) => (
                <div key={i} className="p-3 rounded-lg border border-slate-700 light:border-slate-200 animate-pulse">
                  <div className="flex items-start gap-3">
                    <div className="w-5 h-5 bg-slate-700 light:bg-slate-200 rounded mt-0.5" />
                    <div className="flex-1 space-y-2">
                      <div className="h-4 w-3/4 bg-slate-700 light:bg-slate-200 rounded" />
                      <div className="h-5 w-16 bg-slate-700 light:bg-slate-200 rounded" />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
          <>
          {evaluations.map((evaluation) => {
            const status = statusConfig[evaluation.status];
            return (
              <button
                key={evaluation.id}
                onClick={() => setSelectedEvaluation(evaluation)}
                className={`w-full flex items-start gap-3 p-3 rounded-lg text-left transition-colors ${
                  selectedEvaluation?.id === evaluation.id
                    ? 'bg-slate-800 light:bg-cyan-50 border border-slate-600 light:border-cyan-200'
                    : 'hover:bg-slate-800/50 light:hover:bg-slate-100'
                }`}
              >
                <BarChart3 className="w-5 h-5 text-slate-500 light:text-slate-400 mt-0.5 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-slate-200 light:text-slate-800 truncate">
                    {evaluation.name}
                  </p>
                  <div className="flex items-center gap-2 mt-1">
                    <Badge variant={status.variant}>{t(status.labelKey)}</Badge>
                  </div>
                </div>
              </button>
            );
          })}
          {evaluations.length === 0 && !listLoading && (
            <div className="text-center py-8 text-slate-500 light:text-slate-400 text-sm">
              {t('noEvaluations')}
            </div>
          )}
          </>
          )}
        </div>
      </div>

      <div className="flex-1 flex flex-col overflow-hidden">
        {selectedEvaluation ? (
          <>
            {/* Header - fixed */}
            <div className="flex-shrink-0 p-6 pb-0 space-y-6">
              <div className="flex items-center justify-between">
                <div className="flex-1">
                  {isEditingName ? (
                    <div className="flex items-center gap-2">
                      <Input
                        value={editingName}
                        onChange={(e) => setEditingName(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') saveEvaluationName();
                          if (e.key === 'Escape') cancelEditingName();
                        }}
                        className="max-w-md"
                        autoFocus
                      />
                      <Button size="sm" onClick={saveEvaluationName}>
                        <Check className="w-4 h-4" />
                      </Button>
                      <Button size="sm" variant="ghost" onClick={cancelEditingName}>
                        <X className="w-4 h-4" />
                      </Button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2">
                      <h2 className="text-xl font-semibold text-white light:text-slate-900">
                        {selectedEvaluation.name}
                      </h2>
                      <button
                        onClick={startEditingName}
                        className="p-1 hover:bg-slate-700 light:hover:bg-slate-200 rounded transition-colors"
                      >
                        <Pencil className="w-4 h-4 text-slate-400 light:text-slate-500" />
                      </button>
                    </div>
                  )}
                  <p className="text-sm text-slate-500 light:text-slate-400 mt-1">
                    {t('createdAt')} {new Date(selectedEvaluation.created_at).toLocaleString()}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Button onClick={runEvaluation}>
                    {runningCount > 0 ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Play className="w-4 h-4" />
                    )}
                    <span>{t('runEvaluation')}</span>
                    {runningCount > 0 && (
                      <span className="ml-1 px-1.5 py-0.5 text-xs bg-cyan-500/20 text-cyan-400 rounded">
                        {runningCount}
                      </span>
                    )}
                  </Button>
                  <Button variant="ghost" onClick={handleCopyEvaluation}>
                    <Copy className="w-4 h-4" />
                  </Button>
                  <Button variant="ghost" onClick={handleDeleteEvaluation}>
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              </div>

              <div className="grid grid-cols-5 gap-4">
                <div className="p-4 bg-slate-800/50 light:bg-white border border-slate-700 light:border-slate-200 rounded-lg light:shadow-sm">
                  <p className="text-xs text-slate-500 light:text-slate-600 mb-2">{t('linkedPrompt')}</p>
                  <Select
                    value={selectedEvaluation.prompt_id || ''}
                    onChange={(e) => handleUpdateEvaluation('prompt_id', e.target.value || null)}
                    options={[
                      { value: '', label: t('noLinkedPrompt') },
                      ...prompts.map((p) => ({ value: p.id, label: `${p.name} (v${p.current_version})` })),
                    ]}
                  />
                  {selectedPrompt && (
                    <p className="text-xs text-cyan-400 light:text-cyan-600 mt-2">
                      {t('currentVersion')}: v{selectedPrompt.current_version}
                    </p>
                  )}
                </div>
                <div className="p-4 bg-slate-800/50 light:bg-white border border-slate-700 light:border-slate-200 rounded-lg light:shadow-sm">
                  <p className="text-xs text-slate-500 light:text-slate-600 mb-2">{t('targetModel')}</p>
                  <ModelSelector
                    models={models}
                    providers={providers}
                    selectedModelId={selectedEvaluation.model_id || ''}
                    onSelect={(modelId) => handleUpdateEvaluation('model_id', modelId || null)}
                    placeholder={t('selectModel')}
                  />
                </div>
                <div className="p-4 bg-slate-800/50 light:bg-white border border-slate-700 light:border-slate-200 rounded-lg light:shadow-sm">
                  <p className="text-xs text-slate-500 light:text-slate-600 mb-2">{t('judgeModel')}</p>
                  <ModelSelector
                    models={models}
                    providers={providers}
                    selectedModelId={selectedEvaluation.judge_model_id || ''}
                    onSelect={(modelId) => handleUpdateEvaluation('judge_model_id', modelId || null)}
                    placeholder={t('noJudgeModel')}
                  />
                </div>
                <div className="p-4 bg-slate-800/50 light:bg-white border border-slate-700 light:border-slate-200 rounded-lg light:shadow-sm">
                  <p className="text-xs text-slate-500 light:text-slate-600 mb-2">{t('passThreshold')}</p>
                  <Select
                    value={String((selectedEvaluation.config.pass_threshold || 0.6) * 10)}
                    onChange={(e) => handleUpdateConfig('pass_threshold', Number(e.target.value) / 10)}
                    options={[
                      { value: '10', label: t('threshold10') },
                      { value: '9', label: t('threshold9') },
                      { value: '8', label: t('threshold8') },
                      { value: '7', label: t('threshold7') },
                      { value: '6', label: t('threshold6') },
                      { value: '5', label: t('threshold5') },
                      { value: '4', label: t('threshold4') },
                      { value: '3', label: t('threshold3') },
                      { value: '0', label: t('threshold0') },
                    ]}
                  />
                </div>
                <div className="p-4 bg-slate-800/50 light:bg-white border border-slate-700 light:border-slate-200 rounded-lg light:shadow-sm">
                  <p className="text-xs text-slate-500 light:text-slate-600 mb-1">{t('status')}</p>
                  <Badge variant={statusConfig[selectedEvaluation.status].variant}>
                    {t(statusConfig[selectedEvaluation.status].labelKey)}
                  </Badge>
                </div>
              </div>

              <div className="border-b border-slate-700 light:border-slate-200">
                <nav className="flex gap-4">
                  <button
                    onClick={() => setActiveTab('testcases')}
                    className={`pb-3 px-1 text-sm font-medium border-b-2 transition-colors flex items-center gap-2 ${
                      activeTab === 'testcases'
                        ? 'border-cyan-500 text-cyan-400 light:text-cyan-600'
                        : 'border-transparent text-slate-500 light:text-slate-600 hover:text-slate-300 light:hover:text-slate-800'
                    }`}
                  >
                    <FileText className="w-4 h-4" />
                    {t('testCasesCount', { count: testCases.length })}
                  </button>
                  <button
                    onClick={() => setActiveTab('criteria')}
                    className={`pb-3 px-1 text-sm font-medium border-b-2 transition-colors flex items-center gap-2 ${
                      activeTab === 'criteria'
                        ? 'border-cyan-500 text-cyan-400 light:text-cyan-600'
                        : 'border-transparent text-slate-500 light:text-slate-600 hover:text-slate-300 light:hover:text-slate-800'
                    }`}
                  >
                    <Settings2 className="w-4 h-4" />
                    {t('criteriaCount', { count: criteria.filter((c) => c.enabled).length })}
                  </button>
                  <button
                    onClick={() => setActiveTab('history')}
                    className={`pb-3 px-1 text-sm font-medium border-b-2 transition-colors flex items-center gap-2 ${
                      activeTab === 'history'
                        ? 'border-cyan-500 text-cyan-400 light:text-cyan-600'
                        : 'border-transparent text-slate-500 light:text-slate-600 hover:text-slate-300 light:hover:text-slate-800'
                    }`}
                  >
                    <History className="w-4 h-4" />
                    {t('executionHistoryCount', { count: runs.length })}
                  </button>
                  <button
                    onClick={() => setActiveTab('results')}
                    className={`pb-3 px-1 text-sm font-medium border-b-2 transition-colors flex items-center gap-2 ${
                      activeTab === 'results'
                        ? 'border-cyan-500 text-cyan-400 light:text-cyan-600'
                        : 'border-transparent text-slate-500 light:text-slate-600 hover:text-slate-300 light:hover:text-slate-800'
                    }`}
                  >
                    <BarChart3 className="w-4 h-4" />
                    {t('resultsCount', { count: results.length })}
                  </button>
                </nav>
              </div>
            </div>

            {/* Content - scrollable */}
            <div className="flex-1 overflow-y-auto p-6 pt-4">
              {detailsLoading ? (
                <div className="space-y-6">
                  {/* Loading indicator at top */}
                  <div className="flex items-center justify-center gap-2 text-sm text-slate-400 light:text-slate-500 py-2">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>{t('loadingDetails')}</span>
                  </div>
                  {/* Skeleton loading */}
                  <div className="animate-pulse space-y-6">
                    <div className="flex items-center gap-4">
                      <div className="h-4 w-32 bg-slate-700 light:bg-slate-200 rounded" />
                      <div className="h-4 w-20 bg-slate-700 light:bg-slate-200 rounded" />
                    </div>
                    {[1, 2, 3].map((i) => (
                      <div key={i} className="p-4 border border-slate-700 light:border-slate-200 rounded-lg space-y-3">
                        <div className="flex items-center gap-3">
                          <div className="h-6 w-6 bg-slate-700 light:bg-slate-200 rounded-full" />
                          <div className="h-4 w-40 bg-slate-700 light:bg-slate-200 rounded" />
                        </div>
                        <div className="h-20 bg-slate-700/50 light:bg-slate-100 rounded" />
                        <div className="flex gap-2">
                          <div className="h-3 w-16 bg-slate-700 light:bg-slate-200 rounded" />
                          <div className="h-3 w-24 bg-slate-700 light:bg-slate-200 rounded" />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
              <div>
                {activeTab === 'testcases' && (
                  <TestCaseList
                    testCases={testCases}
                    variables={promptVariables}
                    onAdd={handleAddTestCase}
                    onUpdate={handleUpdateTestCase}
                    onDelete={handleDeleteTestCase}
                    onRunSingle={handleRunSingleTestCase}
                    runningTestCaseId={runningTestCaseId}
                    fileUploadCapabilities={fileUploadCapabilities}
                    providerType={currentModelInfo.providerType}
                    modelId={currentModelInfo.modelId}
                    supportsVision={currentModelInfo.supportsVision}
                  />
                )}

                {activeTab === 'criteria' && (
                  <CriteriaEditor
                    criteria={criteria}
                    onAdd={handleAddCriterion}
                    onUpdate={handleUpdateCriterion}
                    onDelete={handleDeleteCriterion}
                  />
                )}

                {activeTab === 'history' && (
                  <RunHistory
                    runs={runs}
                    selectedRunId={selectedRun?.id || null}
                    onSelectRun={handleSelectRun}
                    onStopRun={handleStopRun}
                    onDeleteRun={handleDeleteRun}
                  />
                )}

                {activeTab === 'results' && (
                  results.length > 0 && selectedRun ? (
                    <div className="space-y-4">
                      <div className="flex items-center justify-between p-3 bg-slate-800/30 light:bg-slate-100 border border-slate-700 light:border-slate-200 rounded-lg">
                        <div className="flex items-center gap-3">
                          <span className="text-sm text-slate-400 light:text-slate-600">{t('currentViewing')}</span>
                          <Badge variant={statusConfig[selectedRun.status].variant}>
                            {new Date(selectedRun.started_at).toLocaleString()}
                          </Badge>
                        </div>
                        {runs.length > 1 && (
                          <button
                            onClick={() => setActiveTab('history')}
                            className="text-xs text-cyan-400 light:text-cyan-600 hover:text-cyan-300 light:hover:text-cyan-700 flex items-center gap-1"
                          >
                            <History className="w-3 h-3" />
                            {t('viewOtherRecords')}
                          </button>
                        )}
                      </div>
                      <EvaluationResultsView
                        testCases={testCases}
                        results={results}
                        criteria={criteria}
                        overallScores={selectedRun.results?.scores || {}}
                        summary={selectedRun.results?.summary}
                      />
                    </div>
                  ) : (
                    <div className="flex items-center justify-center py-12 text-slate-500 light:text-slate-600">
                      <div className="text-center">
                        <AlertCircle className="w-12 h-12 mx-auto mb-3 text-slate-600 light:text-slate-400" />
                        <p>{t('noResultsYet')}</p>
                        <p className="text-xs mt-1">{t('addTestCasesAndRun')}</p>
                      </div>
                    </div>
                  )
                )}
              </div>
              )}
            </div>
          </>
        ) : (
          <div className="h-full flex items-center justify-center">
            <div className="text-center">
              <BarChart3 className="w-16 h-16 mx-auto mb-4 text-slate-700 light:text-slate-400" />
              <p className="text-slate-500 light:text-slate-600">{t('selectEvaluationToView')}</p>
            </div>
          </div>
        )}
      </div>

      <Modal isOpen={showNewEval} onClose={() => setShowNewEval(false)} title={t('newEvaluation')}>
        <div className="space-y-4">
          <Input
            label={t('evaluationName')}
            value={newEvalName}
            onChange={(e) => setNewEvalName(e.target.value)}
            placeholder={t('evaluationNamePlaceholder')}
            autoFocus
          />
          <Select
            label={t('linkedPromptOptional')}
            value={newEvalPrompt}
            onChange={(e) => setNewEvalPrompt(e.target.value)}
            options={[
              { value: '', label: t('noLinkedPrompt') },
              ...prompts.map((p) => ({ value: p.id, label: p.name })),
            ]}
          />
          <div>
            <label className="block text-sm font-medium text-slate-300 light:text-slate-700 mb-1.5">
              {t('targetModel')}
            </label>
            <ModelSelector
              models={models}
              providers={providers}
              selectedModelId={newEvalModel}
              onSelect={setNewEvalModel}
              placeholder={t('selectModel')}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-300 light:text-slate-700 mb-1.5">
              {t('judgeModel')}
            </label>
            <ModelSelector
              models={models}
              providers={providers}
              selectedModelId={newEvalJudgeModel}
              onSelect={setNewEvalJudgeModel}
              placeholder={t('noJudgeModel')}
            />
          </div>
          <p className="text-xs text-slate-500 light:text-slate-600">
            {tCommon('judgeModelDescription')}
          </p>
          <div className="flex justify-end gap-3 pt-4 border-t border-slate-700 light:border-slate-200">
            <Button variant="ghost" onClick={() => setShowNewEval(false)}>
              {tCommon('cancel')}
            </Button>
            <Button onClick={handleCreateEvaluation} disabled={!newEvalName.trim()}>
              {tCommon('create')}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
