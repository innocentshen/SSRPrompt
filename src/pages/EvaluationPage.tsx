import { useState, useEffect, useCallback, useRef } from 'react';
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
import { Button, Input, Modal, Badge, Select, useToast } from '../components/ui';
import { TestCaseList, CriteriaEditor, EvaluationResultsView, RunHistory } from '../components/Evaluation';
import { getDatabase, isDatabaseConfigured } from '../lib/database';
import { callAIModel, type FileAttachment } from '../lib/ai-service';
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

const statusConfig: Record<EvaluationStatus, { label: string; variant: 'info' | 'warning' | 'success' | 'error' }> = {
  pending: { label: '待运行', variant: 'info' },
  running: { label: '运行中', variant: 'warning' },
  completed: { label: '已完成', variant: 'success' },
  failed: { label: '失败', variant: 'error' },
};

type TabType = 'testcases' | 'criteria' | 'history' | 'results';

export function EvaluationPage() {
  const { showToast } = useToast();
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
  const [isEditingName, setIsEditingName] = useState(false);
  const [editingName, setEditingName] = useState('');
  const abortControllersRef = useRef<Map<string, { aborted: boolean }>>(new Map());

  useEffect(() => {
    loadData();
  }, []);

  const loadEvaluationDetails = useCallback(async (evaluationId: string) => {
    setDetailsLoading(true);
    try {
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

      if (testCasesRes.data) setTestCases(testCasesRes.data);
      if (criteriaRes.data) setCriteria(criteriaRes.data);
      if (runsRes.data) {
        setRuns(runsRes.data);
        const latestCompletedRun = runsRes.data.find(r => r.status === 'completed');
        if (latestCompletedRun) {
          setSelectedRun(latestCompletedRun);
          const resultsRes = await db
            .from('test_case_results')
            .select('*')
            .eq('run_id', latestCompletedRun.id)
            .order('created_at');
          if (resultsRes.data) setResults(resultsRes.data);
        } else {
          setSelectedRun(null);
          setResults([]);
        }
      } else {
        setRuns([]);
        setSelectedRun(null);
        setResults([]);
      }
    } finally {
      setDetailsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (selectedEvaluation) {
      loadEvaluationDetails(selectedEvaluation.id);
    } else {
      setTestCases([]);
      setCriteria([]);
      setResults([]);
      setRuns([]);
      setSelectedRun(null);
    }
  }, [selectedEvaluation, loadEvaluationDetails]);

  const loadData = async () => {
    // 检查数据库是否已配置
    if (!isDatabaseConfigured()) {
      setListLoading(false);
      return;
    }

    setListLoading(true);
    try {
      const db = getDatabase();
      const [evalsRes, promptsRes, modelsRes, providersRes] = await Promise.all([
        db.from('evaluations').select('*').order('created_at', { ascending: false }),
        db.from('prompts').select('*'),
        db.from('models').select('*'),
        db.from('providers').select('*').eq('enabled', true),
      ]);

      if (evalsRes.data) {
        setEvaluations(evalsRes.data);
        if (evalsRes.data.length > 0 && !selectedEvaluation) {
          setSelectedEvaluation(evalsRes.data[0]);
        }
      }
      if (promptsRes.data) setPrompts(promptsRes.data);
      if (modelsRes.data) setModels(modelsRes.data);
      if (providersRes.data) setProviders(providersRes.data);
    } finally {
      setListLoading(false);
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
        showToast('error', '创建失败: ' + error.message);
        return;
      }

      if (data) {
        setEvaluations((prev) => [data, ...prev]);
        setSelectedEvaluation(data);
        setNewEvalName('');
        setNewEvalPrompt('');
        setNewEvalModel('');
        setNewEvalJudgeModel('');
        setShowNewEval(false);
        showToast('success', '评测已创建');
      }
    } catch {
      showToast('error', '创建评测失败');
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
      showToast('error', '添加失败: ' + error.message);
      return;
    }

    if (data) {
      setTestCases((prev) => [...prev, data]);
    }
  };

  const handleUpdateTestCase = async (testCase: TestCase) => {
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
      showToast('error', '更新失败: ' + error.message);
      return;
    }

    setTestCases((prev) =>
      prev.map((tc) => (tc.id === testCase.id ? testCase : tc))
    );
  };

  const handleDeleteTestCase = async (id: string) => {
    const { error } = await getDatabase().from('test_cases').delete().eq('id', id);
    if (error) {
      showToast('error', '删除失败: ' + error.message);
      return;
    }
    setTestCases((prev) => prev.filter((tc) => tc.id !== id));
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
      showToast('error', '添加失败: ' + error.message);
      return;
    }

    if (data) {
      setCriteria((prev) => [...prev, data]);
    }
  };

  const handleUpdateCriterion = async (criterion: EvaluationCriterion) => {
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
      showToast('error', '更新失败: ' + error.message);
      return;
    }

    setCriteria((prev) =>
      prev.map((c) => (c.id === criterion.id ? criterion : c))
    );
  };

  const handleDeleteCriterion = async (id: string) => {
    const { error } = await getDatabase().from('evaluation_criteria').delete().eq('id', id);
    if (error) {
      showToast('error', '删除失败: ' + error.message);
      return;
    }
    setCriteria((prev) => prev.filter((c) => c.id !== id));
  };

  const handleSelectRun = async (run: EvaluationRun) => {
    setSelectedRun(run);
    const resultsRes = await getDatabase()
      .from('test_case_results')
      .select('*')
      .eq('run_id', run.id)
      .order('created_at');
    if (resultsRes.data) {
      setResults(resultsRes.data);
    }
    setActiveTab('results');
  };

  const runEvaluation = async () => {
    if (!selectedEvaluation) return;
    if (testCases.length === 0) {
      showToast('error', '请先添加测试用例');
      return;
    }
    if (!selectedEvaluation.model_id) {
      showToast('error', '请先选择被测模型');
      return;
    }

    const model = models.find((m) => m.id === selectedEvaluation.model_id);
    const provider = providers.find((p) => p.id === model?.provider_id);
    const prompt = prompts.find((p) => p.id === selectedEvaluation.prompt_id);

    if (!model || !provider) {
      showToast('error', '模型或服务商未找到');
      return;
    }

    const evalId = selectedEvaluation.id;
    const evalConfig = selectedEvaluation.config;
    const judgeModelId = selectedEvaluation.judge_model_id;
    const currentTestCases = [...testCases];
    const enabledCriteria = criteria.filter((c) => c.enabled);

    showToast('info', '评测已启动，正在后台运行...');
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
      showToast('error', '创建执行记录失败');
      setRunningCount(prev => Math.max(0, prev - 1));
      return;
    }

    const currentRun = runData as EvaluationRun;
    setRuns(prev => [currentRun, ...prev]);
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
                  aiFeedback[criterion.name] = '评估失败';
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
            error_message: err instanceof Error ? err.message : '未知错误',
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
        summary: `共 ${currentTestCases.length} 个测试用例，通过 ${passedCount} 个，通过率 ${((passedCount / currentTestCases.length) * 100).toFixed(0)}%`,
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

      abortControllersRef.current.delete(currentRun.id);
      setRunningCount(prev => Math.max(0, prev - 1));
      showToast('success', '评测完成');
    })();
  };

  const handleStopRun = async (runId: string) => {
    const controller = abortControllersRef.current.get(runId);
    if (controller) {
      controller.aborted = true;
      abortControllersRef.current.delete(runId);
    }

    const run = runs.find(r => r.id === runId);
    if (!run) return;

    const errorMessage = '评测已被用户中止';

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
    showToast('info', '评测已中止');
  };

  const handleDeleteRun = async (runId: string) => {
    try {
      // First delete related test case results
      await getDatabase().from('test_case_results').delete().eq('run_id', runId);

      // Then delete the run itself
      const { error } = await getDatabase().from('evaluation_runs').delete().eq('id', runId);
      if (error) {
        showToast('error', '删除失败');
        return;
      }

      setRuns((prev) => prev.filter((r) => r.id !== runId));
      setResults((prev) => prev.filter((r) => r.run_id !== runId));

      if (selectedRun?.id === runId) {
        const remainingRuns = runs.filter((r) => r.id !== runId);
        setSelectedRun(remainingRuns[0] || null);
      }

      showToast('success', '执行记录已删除');
    } catch {
      showToast('error', '删除执行记录失败');
    }
  };

  const handleDeleteEvaluation = async () => {
    if (!selectedEvaluation) return;
    try {
      const { error } = await getDatabase().from('evaluations').delete().eq('id', selectedEvaluation.id);
      if (error) {
        showToast('error', '删除失败: ' + error.message);
        return;
      }
      const remaining = evaluations.filter((e) => e.id !== selectedEvaluation.id);
      setEvaluations(remaining);
      setSelectedEvaluation(remaining[0] || null);
      showToast('success', '评测已删除');
    } catch {
      showToast('error', '删除评测失败');
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
        showToast('error', '复制评测失败: ' + (evalError?.message || '未知错误'));
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
              if (error) throw new Error('复制测试用例失败: ' + error.message);
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
              if (error) throw new Error('复制评价标准失败: ' + error.message);
            })
        );
      }

      await Promise.all(copyPromises);

      setEvaluations((prev) => [newEval, ...prev]);
      setSelectedEvaluation(newEval);
      showToast('success', '评测已复制');
    } catch (err) {
      showToast('error', err instanceof Error ? err.message : '复制评测失败');
    }
  };

  const handleUpdateEvaluation = async (field: string, value: string | null) => {
    if (!selectedEvaluation) return;

    const { error } = await getDatabase()
      .from('evaluations')
      .update({ [field]: value })
      .eq('id', selectedEvaluation.id);

    if (error) {
      showToast('error', '更新失败: ' + error.message);
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
      showToast('error', '更新失败: ' + error.message);
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
      showToast('error', '名称不能为空');
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
            <span>新建评测</span>
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
                    <Badge variant={status.variant}>{status.label}</Badge>
                  </div>
                </div>
              </button>
            );
          })}
          {evaluations.length === 0 && !listLoading && (
            <div className="text-center py-8 text-slate-500 light:text-slate-400 text-sm">
              暂无评测任务
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
                    创建于 {new Date(selectedEvaluation.created_at).toLocaleString('zh-CN')}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Button onClick={runEvaluation}>
                    {runningCount > 0 ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Play className="w-4 h-4" />
                    )}
                    <span>运行评测</span>
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
                  <p className="text-xs text-slate-500 light:text-slate-600 mb-2">关联 Prompt</p>
                  <Select
                    value={selectedEvaluation.prompt_id || ''}
                    onChange={(e) => handleUpdateEvaluation('prompt_id', e.target.value || null)}
                    options={[
                      { value: '', label: '不关联 Prompt' },
                      ...prompts.map((p) => ({ value: p.id, label: `${p.name} (v${p.current_version})` })),
                    ]}
                  />
                  {selectedPrompt && (
                    <p className="text-xs text-cyan-400 light:text-cyan-600 mt-2">
                      当前使用版本: v{selectedPrompt.current_version}
                    </p>
                  )}
                </div>
                <div className="p-4 bg-slate-800/50 light:bg-white border border-slate-700 light:border-slate-200 rounded-lg light:shadow-sm">
                  <p className="text-xs text-slate-500 light:text-slate-600 mb-2">被测模型</p>
                  <Select
                    value={selectedEvaluation.model_id || ''}
                    onChange={(e) => handleUpdateEvaluation('model_id', e.target.value || null)}
                    options={[
                      { value: '', label: '选择模型' },
                      ...enabledModels.map((m) => ({ value: m.id, label: m.name })),
                    ]}
                  />
                </div>
                <div className="p-4 bg-slate-800/50 light:bg-white border border-slate-700 light:border-slate-200 rounded-lg light:shadow-sm">
                  <p className="text-xs text-slate-500 light:text-slate-600 mb-2">评价模型 (Judge)</p>
                  <Select
                    value={selectedEvaluation.judge_model_id || ''}
                    onChange={(e) => handleUpdateEvaluation('judge_model_id', e.target.value || null)}
                    options={[
                      { value: '', label: '不使用AI评价' },
                      ...enabledModels.map((m) => ({ value: m.id, label: m.name })),
                    ]}
                  />
                </div>
                <div className="p-4 bg-slate-800/50 light:bg-white border border-slate-700 light:border-slate-200 rounded-lg light:shadow-sm">
                  <p className="text-xs text-slate-500 light:text-slate-600 mb-2">通过阈值</p>
                  <Select
                    value={String((selectedEvaluation.config.pass_threshold || 0.6) * 10)}
                    onChange={(e) => handleUpdateConfig('pass_threshold', Number(e.target.value) / 10)}
                    options={[
                      { value: '10', label: '10分 (满分通过)' },
                      { value: '9', label: '9分以上' },
                      { value: '8', label: '8分以上' },
                      { value: '7', label: '7分以上' },
                      { value: '6', label: '6分以上 (默认)' },
                      { value: '5', label: '5分以上' },
                      { value: '4', label: '4分以上' },
                      { value: '3', label: '3分以上' },
                      { value: '0', label: '不限制' },
                    ]}
                  />
                </div>
                <div className="p-4 bg-slate-800/50 light:bg-white border border-slate-700 light:border-slate-200 rounded-lg light:shadow-sm">
                  <p className="text-xs text-slate-500 light:text-slate-600 mb-1">状态</p>
                  <Badge variant={statusConfig[selectedEvaluation.status].variant}>
                    {statusConfig[selectedEvaluation.status].label}
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
                    测试用例 ({testCases.length})
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
                    评价标准 ({criteria.filter((c) => c.enabled).length})
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
                    执行历史 ({runs.length})
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
                    评测结果 ({results.length})
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
                    <span>加载评测详情中...</span>
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
                          <span className="text-sm text-slate-400 light:text-slate-600">当前查看:</span>
                          <Badge variant={statusConfig[selectedRun.status].variant}>
                            {new Date(selectedRun.started_at).toLocaleString('zh-CN')}
                          </Badge>
                        </div>
                        {runs.length > 1 && (
                          <button
                            onClick={() => setActiveTab('history')}
                            className="text-xs text-cyan-400 light:text-cyan-600 hover:text-cyan-300 light:hover:text-cyan-700 flex items-center gap-1"
                          >
                            <History className="w-3 h-3" />
                            查看其他执行记录
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
                        <p>暂无评测结果</p>
                        <p className="text-xs mt-1">添加测试用例后点击"运行评测"</p>
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
              <p className="text-slate-500 light:text-slate-600">选择一个评测任务查看详情</p>
            </div>
          </div>
        )}
      </div>

      <Modal isOpen={showNewEval} onClose={() => setShowNewEval(false)} title="新建评测">
        <div className="space-y-4">
          <Input
            label="评测名称"
            value={newEvalName}
            onChange={(e) => setNewEvalName(e.target.value)}
            placeholder="给评测起个名字"
            autoFocus
          />
          <Select
            label="关联 Prompt (可选)"
            value={newEvalPrompt}
            onChange={(e) => setNewEvalPrompt(e.target.value)}
            options={[
              { value: '', label: '不关联 Prompt' },
              ...prompts.map((p) => ({ value: p.id, label: p.name })),
            ]}
          />
          <Select
            label="被测模型"
            value={newEvalModel}
            onChange={(e) => setNewEvalModel(e.target.value)}
            options={[
              { value: '', label: '选择模型' },
              ...enabledModels.map((m) => ({ value: m.id, label: m.name })),
            ]}
          />
          <Select
            label="评价模型 (Judge)"
            value={newEvalJudgeModel}
            onChange={(e) => setNewEvalJudgeModel(e.target.value)}
            options={[
              { value: '', label: '不使用AI评价' },
              ...enabledModels.map((m) => ({ value: m.id, label: m.name })),
            ]}
          />
          <p className="text-xs text-slate-500 light:text-slate-600">
            评价模型用于对被测模型的输出进行AI打分和评价
          </p>
          <div className="flex justify-end gap-3 pt-4 border-t border-slate-700 light:border-slate-200">
            <Button variant="ghost" onClick={() => setShowNewEval(false)}>
              取消
            </Button>
            <Button onClick={handleCreateEvaluation} disabled={!newEvalName.trim()}>
              创建
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
