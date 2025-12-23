import { useState } from 'react';
import { CheckCircle2, XCircle, ChevronDown, ChevronRight, Clock, Zap, Paperclip, Eye, FileText, Image, Code, File } from 'lucide-react';
import { Badge, MarkdownRenderer, Modal } from '../ui';
import type { TestCase, TestCaseResult, EvaluationCriterion, FileAttachmentData } from '../../types';
import { isImageFile, isPdfFile, isTextFile, readTextContent, getSyntaxLanguage, getFileIconType } from '../../lib/file-utils';

interface EvaluationResultsViewProps {
  testCases: TestCase[];
  results: TestCaseResult[];
  criteria: EvaluationCriterion[];
  overallScores: Record<string, number>;
  summary?: string;
}

export function EvaluationResultsView({
  testCases,
  results,
  criteria,
  overallScores,
  summary,
}: EvaluationResultsViewProps) {
  const [expandedResultId, setExpandedResultId] = useState<string | null>(null);
  const [expandedOutputs, setExpandedOutputs] = useState<Set<string>>(new Set());
  const [previewAttachment, setPreviewAttachment] = useState<FileAttachmentData | null>(null);

  const getTestCaseName = (testCaseId: string, index: number) => {
    const testCase = testCases.find((tc) => tc.id === testCaseId);
    return testCase?.name || `测试用例 #${index + 1}`;
  };

  const getExpectedOutput = (testCaseId: string) => {
    const testCase = testCases.find((tc) => tc.id === testCaseId);
    return testCase?.expected_output || null;
  };

  const getTestCaseNotes = (testCaseId: string) => {
    const testCase = testCases.find((tc) => tc.id === testCaseId);
    return testCase?.notes || null;
  };

  const getTestCaseAttachments = (testCaseId: string) => {
    const testCase = testCases.find((tc) => tc.id === testCaseId);
    return testCase?.attachments || [];
  };

  const getFileIcon = (attachment: { type: string; name?: string }) => {
    const iconType = getFileIconType(attachment);
    switch (iconType) {
      case 'image':
        return Image;
      case 'pdf':
        return FileText;
      case 'code':
        return Code;
      case 'text':
        return FileText;
      default:
        return File;
    }
  };

  const renderAttachmentPreview = (attachment: FileAttachmentData) => {
    if (isImageFile(attachment)) {
      return (
        <div className="flex items-center justify-center h-full">
          <img
            src={`data:${attachment.type};base64,${attachment.base64}`}
            alt={attachment.name}
            className="max-w-full max-h-[70vh] object-contain"
          />
        </div>
      );
    }
    if (isPdfFile(attachment)) {
      return (
        <iframe
          src={`data:application/pdf;base64,${attachment.base64}`}
          className="w-full h-[70vh]"
          title={attachment.name}
        />
      );
    }
    if (isTextFile(attachment)) {
      const textContent = readTextContent(attachment.base64);
      const language = getSyntaxLanguage(attachment);
      return (
        <div className="h-[70vh] overflow-auto">
          <pre className="p-4 bg-slate-900 light:bg-slate-100 rounded-lg text-sm font-mono text-slate-300 light:text-slate-700 whitespace-pre-wrap break-words">
            <code className={`language-${language}`}>{textContent}</code>
          </pre>
        </div>
      );
    }
    return (
      <div className="flex items-center justify-center h-[200px] text-slate-500 light:text-slate-600">
        无法预览此文件类型
      </div>
    );
  };

  const toggleOutputExpanded = (resultId: string) => {
    setExpandedOutputs((prev) => {
      const next = new Set(prev);
      if (next.has(resultId)) {
        next.delete(resultId);
      } else {
        next.add(resultId);
      }
      return next;
    });
  };

  const enabledCriteria = criteria.filter((c) => c.enabled);

  const passedCount = results.filter((r) => r.passed).length;
  const totalCount = results.length;
  const passRate = totalCount > 0 ? (passedCount / totalCount) * 100 : 0;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 lg:grid-cols-6 gap-4">
        <div className="p-4 bg-slate-800/50 light:bg-emerald-50 border border-slate-700 light:border-emerald-200 rounded-lg text-center">
          <p className="text-3xl font-bold text-emerald-400 light:text-emerald-600">{passedCount}</p>
          <p className="text-xs text-slate-500 light:text-slate-600 mt-1">通过</p>
        </div>
        <div className="p-4 bg-slate-800/50 light:bg-rose-50 border border-slate-700 light:border-rose-200 rounded-lg text-center">
          <p className="text-3xl font-bold text-rose-400 light:text-rose-600">{totalCount - passedCount}</p>
          <p className="text-xs text-slate-500 light:text-slate-600 mt-1">失败</p>
        </div>
        <div className="p-4 bg-slate-800/50 light:bg-cyan-50 border border-slate-700 light:border-cyan-200 rounded-lg text-center">
          <p className="text-3xl font-bold text-cyan-400 light:text-cyan-600">{passRate.toFixed(0)}%</p>
          <p className="text-xs text-slate-500 light:text-slate-600 mt-1">通过率</p>
        </div>
        <div className="p-4 bg-slate-800/50 light:bg-teal-50 border border-slate-700 light:border-teal-200 rounded-lg text-center">
          <p className="text-3xl font-bold text-teal-400 light:text-teal-600">
            {results.reduce((sum, r) => sum + r.tokens_input, 0).toLocaleString()}
          </p>
          <p className="text-xs text-slate-500 light:text-slate-600 mt-1">输入 Token</p>
        </div>
        <div className="p-4 bg-slate-800/50 light:bg-sky-50 border border-slate-700 light:border-sky-200 rounded-lg text-center">
          <p className="text-3xl font-bold text-sky-400 light:text-sky-600">
            {results.reduce((sum, r) => sum + r.tokens_output, 0).toLocaleString()}
          </p>
          <p className="text-xs text-slate-500 light:text-slate-600 mt-1">输出 Token</p>
        </div>
        <div className="p-4 bg-slate-800/50 light:bg-amber-50 border border-slate-700 light:border-amber-200 rounded-lg text-center">
          <p className="text-3xl font-bold text-amber-400 light:text-amber-600">
            {(results.reduce((sum, r) => sum + r.latency_ms, 0) / 1000).toFixed(1)}s
          </p>
          <p className="text-xs text-slate-500 light:text-slate-600 mt-1">总耗时</p>
        </div>
      </div>

      {Object.keys(overallScores).length > 0 && (
        <div>
          <h4 className="text-sm font-medium text-slate-300 light:text-slate-700 mb-3">评分概览</h4>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {Object.entries(overallScores).map(([key, value]) => (
              <div
                key={key}
                className="p-3 bg-slate-800/50 light:bg-white border border-slate-700 light:border-slate-200 rounded-lg light:shadow-sm"
              >
                <div className="flex items-center justify-between">
                  <span className="text-sm text-slate-400 light:text-slate-600">{key}</span>
                  <span className="text-lg font-semibold text-cyan-400 light:text-cyan-600">
                    {(value * 10).toFixed(1)}
                  </span>
                </div>
                <div className="mt-2 h-1.5 bg-slate-700 light:bg-slate-200 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-cyan-500 to-cyan-400 light:from-cyan-500 light:to-cyan-400 rounded-full"
                    style={{ width: `${value * 100}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {summary && (
        <div className="p-4 bg-slate-800/50 light:bg-slate-50 border border-slate-700 light:border-slate-200 rounded-lg">
          <h4 className="text-sm font-medium text-slate-300 light:text-slate-700 mb-2">评测总结</h4>
          <p className="text-sm text-slate-400 light:text-slate-600">{summary}</p>
        </div>
      )}

      <div>
        <h4 className="text-sm font-medium text-slate-300 light:text-slate-700 mb-3">详细结果</h4>
        <div className="space-y-2">
          {results.map((result, index) => (
            <div
              key={result.id}
              className="border border-slate-700 light:border-slate-200 rounded-lg bg-slate-800/30 light:bg-white overflow-hidden light:shadow-sm"
            >
              <button
                onClick={() =>
                  setExpandedResultId(expandedResultId === result.id ? null : result.id)
                }
                className="w-full flex items-center gap-3 p-4 hover:bg-slate-800/50 light:hover:bg-slate-50 transition-colors"
              >
                <div className="flex items-center gap-3 flex-1 min-w-0">
                  {result.passed ? (
                    <CheckCircle2 className="w-5 h-5 text-emerald-500 light:text-emerald-600 flex-shrink-0" />
                  ) : (
                    <XCircle className="w-5 h-5 text-rose-500 light:text-rose-600 flex-shrink-0" />
                  )}
                  <span className="text-sm font-medium text-slate-200 light:text-slate-800 truncate">
                    {getTestCaseName(result.test_case_id, index)}
                  </span>
                  {getTestCaseAttachments(result.test_case_id).length > 0 && (
                    <span className="flex items-center gap-1 text-xs text-slate-500 light:text-slate-600">
                      <Paperclip className="w-3 h-3" />
                      {getTestCaseAttachments(result.test_case_id).length}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-4 text-xs text-slate-500 light:text-slate-600">
                  <span className="flex items-center gap-1">
                    <Clock className="w-3 h-3" />
                    {result.latency_ms}ms
                  </span>
                  <span className="flex items-center gap-1">
                    <Zap className="w-3 h-3" />
                    {result.tokens_input + result.tokens_output} tokens
                  </span>
                  {expandedResultId === result.id ? (
                    <ChevronDown className="w-4 h-4" />
                  ) : (
                    <ChevronRight className="w-4 h-4" />
                  )}
                </div>
              </button>

              {expandedResultId === result.id && (
                <div className="p-4 pt-0 space-y-4 border-t border-slate-700/50 light:border-slate-200">
                  <div>
                    <button
                      onClick={() => toggleOutputExpanded(result.id)}
                      className="w-full flex items-center justify-between p-2 bg-slate-800/50 light:bg-slate-100 rounded-t border border-slate-700 light:border-slate-200 hover:bg-slate-800 light:hover:bg-slate-200 transition-colors"
                    >
                      <span className="text-xs font-medium text-slate-400 light:text-slate-600">输出对比</span>
                      {expandedOutputs.has(result.id) ? (
                        <ChevronDown className="w-4 h-4 text-slate-500 light:text-slate-400" />
                      ) : (
                        <ChevronRight className="w-4 h-4 text-slate-500 light:text-slate-400" />
                      )}
                    </button>
                    {expandedOutputs.has(result.id) && (
                      <div className="grid grid-cols-2 gap-0 border border-t-0 border-slate-700 light:border-slate-200 rounded-b overflow-hidden">
                        <div className="border-r border-slate-700 light:border-slate-200">
                          <div className="px-3 py-1.5 bg-slate-800 light:bg-emerald-50 border-b border-slate-700 light:border-slate-200">
                            <span className="text-xs font-medium text-emerald-400 light:text-emerald-600">期望输出</span>
                          </div>
                          <div className="p-3 bg-slate-900 light:bg-white text-sm max-h-64 overflow-y-auto">
                            {getExpectedOutput(result.test_case_id) ? (
                              <MarkdownRenderer content={getExpectedOutput(result.test_case_id)!} />
                            ) : (
                              <span className="text-slate-500 light:text-slate-400 text-xs">未设置期望输出</span>
                            )}
                          </div>
                        </div>
                        <div>
                          <div className="px-3 py-1.5 bg-slate-800 light:bg-cyan-50 border-b border-slate-700 light:border-slate-200">
                            <span className="text-xs font-medium text-cyan-400 light:text-cyan-600">模型输出</span>
                          </div>
                          <div className="p-3 bg-slate-900 light:bg-white text-sm max-h-64 overflow-y-auto">
                            {result.model_output ? (
                              <MarkdownRenderer content={result.model_output} />
                            ) : (
                              <span className="text-slate-500 light:text-slate-400 text-xs">(无输出)</span>
                            )}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>

                  {result.error_message && (
                    <div>
                      <p className="text-xs text-rose-400 light:text-rose-600 mb-1">错误信息</p>
                      <div className="p-3 bg-rose-950/30 light:bg-rose-50 rounded border border-rose-900/50 light:border-rose-200 text-sm text-rose-300 light:text-rose-700">
                        {result.error_message}
                      </div>
                    </div>
                  )}

                  {enabledCriteria.length > 0 && Object.keys(result.scores).length > 0 && (
                    <div>
                      <p className="text-xs text-slate-500 light:text-slate-600 mb-2">评分详情</p>
                      <div className="space-y-2">
                        {enabledCriteria.map((criterion) => (
                          <div
                            key={criterion.id}
                            className="p-3 bg-slate-800 light:bg-slate-50 rounded border border-slate-700 light:border-slate-200"
                          >
                            <div className="flex items-center justify-between mb-2">
                              <span className="text-sm font-medium text-slate-300 light:text-slate-700">
                                {criterion.name}
                              </span>
                              <Badge
                                variant={
                                  (result.scores[criterion.name] || 0) >= 0.7
                                    ? 'success'
                                    : (result.scores[criterion.name] || 0) >= 0.4
                                    ? 'warning'
                                    : 'error'
                                }
                              >
                                {((result.scores[criterion.name] || 0) * 10).toFixed(1)}/10
                              </Badge>
                            </div>
                            {result.ai_feedback[criterion.name] && (
                              <p className="text-xs text-slate-400 light:text-slate-600">
                                {result.ai_feedback[criterion.name]}
                              </p>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {getTestCaseNotes(result.test_case_id) && (
                    <div>
                      <p className="text-xs text-slate-500 light:text-slate-600 mb-2">测试备注</p>
                      <div className="p-3 bg-slate-800/50 light:bg-amber-50 rounded border border-slate-700 light:border-amber-200">
                        <p className="text-sm text-slate-400 light:text-amber-700 whitespace-pre-wrap">
                          {getTestCaseNotes(result.test_case_id)}
                        </p>
                      </div>
                    </div>
                  )}

                  {getTestCaseAttachments(result.test_case_id).length > 0 && (
                    <div>
                      <p className="text-xs text-slate-500 light:text-slate-600 mb-2 flex items-center gap-1">
                        <Paperclip className="w-3 h-3" />
                        附件 ({getTestCaseAttachments(result.test_case_id).length})
                      </p>
                      <div className="flex flex-wrap gap-2">
                        {getTestCaseAttachments(result.test_case_id).map((attachment, i) => {
                          const Icon = getFileIcon(attachment);
                          return (
                            <button
                              key={i}
                              onClick={() => setPreviewAttachment(attachment)}
                              className="flex items-center gap-2 px-3 py-2 bg-slate-800 light:bg-slate-50 rounded border border-slate-700 light:border-slate-200 hover:border-cyan-500 light:hover:border-cyan-400 transition-colors"
                              title="点击预览"
                            >
                              <Icon className="w-4 h-4 text-slate-400 light:text-slate-500" />
                              <span className="text-sm text-slate-300 light:text-slate-700 max-w-[150px] truncate">
                                {attachment.name}
                              </span>
                              <Eye className="w-3 h-3 text-cyan-400 light:text-cyan-600" />
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Attachment Preview Modal */}
      <Modal
        isOpen={!!previewAttachment}
        onClose={() => setPreviewAttachment(null)}
        title={previewAttachment?.name || '附件预览'}
        size="xl"
      >
        {previewAttachment && renderAttachmentPreview(previewAttachment)}
      </Modal>
    </div>
  );
}
