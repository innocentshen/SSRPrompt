import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Sparkles, Wand2, Check, X, Loader2, AlertCircle, ArrowRight, Trophy, Star, TrendingUp, Settings } from 'lucide-react';
import { PromptMessage } from '../../types/database';
import { Button, ModelSelector } from '../ui';
import type { Model, Provider } from '../../types';

export type SuggestionType = 'clarity' | 'structure' | 'specificity' | 'examples' | 'constraints';
export type SuggestionSeverity = 'low' | 'medium' | 'high';

export interface OptimizationSuggestion {
  id: string;
  type: SuggestionType;
  title: string;
  description: string;
  originalText?: string;
  suggestedText?: string;
  messageIndex?: number;
  severity?: SuggestionSeverity;
  applied?: boolean;
}

export interface AnalysisResult {
  score: number;
  summary: string;
  strengths: string[];
  suggestions: OptimizationSuggestion[];
}

interface PromptOptimizerProps {
  messages: PromptMessage[];
  content?: string;
  models: Model[];
  providers: Provider[];
  selectedModelId: string;
  onModelChange: (modelId: string) => void;
  onApplySuggestion: (suggestion: OptimizationSuggestion) => void;
  onOptimize: () => Promise<OptimizationSuggestion[]>;
  onOpenSettings?: () => void;
  isOptimizing?: boolean;
  analysisResult?: AnalysisResult | null;
}

const SUGGESTION_TYPE_CONFIG = {
  clarity: {
    labelKey: 'clarity',
    color: 'text-blue-400 light:text-blue-600',
    bgColor: 'bg-blue-500/10 light:bg-blue-100',
  },
  structure: {
    labelKey: 'structure',
    color: 'text-purple-400 light:text-purple-600',
    bgColor: 'bg-purple-500/10 light:bg-purple-100',
  },
  specificity: {
    labelKey: 'specificity',
    color: 'text-green-400 light:text-green-600',
    bgColor: 'bg-green-500/10 light:bg-green-100',
  },
  examples: {
    labelKey: 'examples',
    color: 'text-amber-400 light:text-amber-600',
    bgColor: 'bg-amber-500/10 light:bg-amber-100',
  },
  constraints: {
    labelKey: 'constraints',
    color: 'text-red-400 light:text-red-600',
    bgColor: 'bg-red-500/10 light:bg-red-100',
  },
};

const SEVERITY_CONFIG = {
  high: {
    labelKey: 'priorityHigh',
    color: 'text-red-400 light:text-red-500',
    bgColor: 'bg-red-500/10',
  },
  medium: {
    labelKey: 'priorityMedium',
    color: 'text-amber-400 light:text-amber-500',
    bgColor: 'bg-amber-500/10',
  },
  low: {
    labelKey: 'priorityLow',
    color: 'text-green-400 light:text-green-500',
    bgColor: 'bg-green-500/10',
  },
};

function getScoreColor(score: number): string {
  if (score >= 90) return 'text-green-400 light:text-green-500';
  if (score >= 70) return 'text-amber-400 light:text-amber-500';
  return 'text-red-400 light:text-red-500';
}

export function PromptOptimizer({
  messages,
  content,
  models,
  providers,
  selectedModelId,
  onModelChange,
  onApplySuggestion,
  onOptimize,
  onOpenSettings,
  isOptimizing = false,
  analysisResult,
}: PromptOptimizerProps) {
  const { t } = useTranslation('prompts');
  const [suggestions, setSuggestions] = useState<OptimizationSuggestion[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [hasAnalyzed, setHasAnalyzed] = useState(false);

  const getScoreLabel = (score: number): string => {
    if (score >= 90) return t('scoreExcellent');
    if (score >= 70) return t('scoreGood');
    if (score >= 50) return t('scoreFair');
    return t('scoreNeedsWork');
  };

  const handleOptimize = async () => {
    setError(null);
    try {
      const newSuggestions = await onOptimize();
      setSuggestions(newSuggestions);
      setHasAnalyzed(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to analyze prompt');
    }
  };

  const handleApply = (suggestion: OptimizationSuggestion) => {
    onApplySuggestion(suggestion);
    setSuggestions((prev) =>
      prev.map((s) => (s.id === suggestion.id ? { ...s, applied: true } : s))
    );
  };

  const handleDismiss = (suggestionId: string) => {
    setSuggestions((prev) => prev.filter((s) => s.id !== suggestionId));
  };

  const hasContent = messages.some((m) => m.content.trim().length > 0) || (content && content.trim().length > 0);
  const displaySuggestions = analysisResult?.suggestions || suggestions;

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Sparkles className="w-5 h-5 text-cyan-400 light:text-cyan-600" />
          <h3 className="text-lg font-medium text-slate-200 light:text-slate-800">
            {t('aiOptimization')}
          </h3>
        </div>
        <div className="flex items-center gap-2">
          {onOpenSettings && (
            <Button
              variant="ghost"
              size="sm"
              onClick={onOpenSettings}
              title={t('configureOptimization')}
            >
              <Settings className="w-4 h-4" />
            </Button>
          )}
          <Button
            variant="primary"
            size="sm"
            onClick={handleOptimize}
            disabled={isOptimizing || !hasContent || !selectedModelId}
          >
            {isOptimizing ? (
              <>
                <Loader2 className="w-4 h-4 mr-1 animate-spin" />
                {t('analyzing')}
              </>
            ) : (
              <>
                <Wand2 className="w-4 h-4 mr-1" />
                {t('analyzePrompt')}
              </>
            )}
          </Button>
        </div>
      </div>

      {/* Model Selector */}
      <div className="mb-4 p-3 bg-slate-800/50 light:bg-slate-100 rounded-lg border border-slate-700 light:border-slate-200">
        <label className="block text-xs text-slate-400 light:text-slate-600 mb-2">
          {t('analyzeModel')}
        </label>
        <ModelSelector
          models={models}
          providers={providers}
          selectedModelId={selectedModelId}
          onSelect={onModelChange}
          placeholder={t('configureProviderFirst')}
        />
        <p className="text-xs text-slate-500 mt-1.5">
          {t('selectAnalyzeModel')}
        </p>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {!hasContent ? (
          <div className="flex flex-col items-center justify-center h-full text-center py-12">
            <Sparkles className="w-12 h-12 text-slate-600 light:text-slate-400 mb-4" />
            <h4 className="text-lg font-medium text-slate-300 light:text-slate-700 mb-2">
              {t('addContentToOptimize')}
            </h4>
            <p className="text-sm text-slate-500 light:text-slate-500 max-w-md">
              {t('writePromptFirstDesc')}
            </p>
          </div>
        ) : !hasAnalyzed && !analysisResult ? (
          <div className="flex flex-col items-center justify-center h-full text-center py-12">
            <Wand2 className="w-12 h-12 text-slate-600 light:text-slate-400 mb-4" />
            <h4 className="text-lg font-medium text-slate-300 light:text-slate-700 mb-2">
              {t('readyToAnalyze')}
            </h4>
            <p className="text-sm text-slate-500 light:text-slate-500 max-w-md mb-4">
              {t('clickAnalyzeDesc')}
            </p>
            <div className="grid grid-cols-2 gap-3 text-left max-w-md">
              {Object.entries(SUGGESTION_TYPE_CONFIG).map(([type, config]) => (
                <div
                  key={type}
                  className={`flex items-center gap-2 px-3 py-2 rounded-lg ${config.bgColor}`}
                >
                  <span className={`text-sm ${config.color}`}>{t(config.labelKey)}</span>
                </div>
              ))}
            </div>
          </div>
        ) : error ? (
          <div className="flex flex-col items-center justify-center h-full text-center py-12">
            <AlertCircle className="w-12 h-12 text-red-400 light:text-red-500 mb-4" />
            <h4 className="text-lg font-medium text-slate-300 light:text-slate-700 mb-2">
              {t('analysisFailed')}
            </h4>
            <p className="text-sm text-red-400 light:text-red-500 mb-4">{error}</p>
            <Button variant="secondary" size="sm" onClick={handleOptimize}>
              {t('retry')}
            </Button>
          </div>
        ) : (
          <div className="space-y-6">
            {/* Score Card */}
            {analysisResult && (
              <div className="bg-slate-800/50 light:bg-slate-100 rounded-lg p-4 border border-slate-700 light:border-slate-200">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <Trophy className="w-5 h-5 text-amber-400" />
                    <span className="text-sm font-medium text-slate-300 light:text-slate-700">{t('scoreResult')}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`text-3xl font-bold ${getScoreColor(analysisResult.score)}`}>
                      {analysisResult.score}
                    </span>
                    <span className="text-slate-500">/100</span>
                    <span className={`px-2 py-0.5 text-xs rounded-full ${getScoreColor(analysisResult.score)} bg-opacity-10 ${analysisResult.score >= 90 ? 'bg-green-500/10' : analysisResult.score >= 70 ? 'bg-amber-500/10' : 'bg-red-500/10'}`}>
                      {getScoreLabel(analysisResult.score)}
                    </span>
                  </div>
                </div>
                <p className="text-sm text-slate-400 light:text-slate-600">{analysisResult.summary}</p>
              </div>
            )}

            {/* Strengths */}
            {analysisResult && analysisResult.strengths.length > 0 && (
              <div className="bg-green-500/5 light:bg-green-50 rounded-lg p-4 border border-green-500/20 light:border-green-200">
                <div className="flex items-center gap-2 mb-3">
                  <Star className="w-5 h-5 text-green-400 light:text-green-600" />
                  <span className="text-sm font-medium text-green-400 light:text-green-700">{t('strengths')}</span>
                </div>
                <ul className="space-y-2">
                  {analysisResult.strengths.map((strength, index) => (
                    <li key={index} className="flex items-start gap-2 text-sm text-slate-300 light:text-slate-700">
                      <Check className="w-4 h-4 text-green-400 light:text-green-600 mt-0.5 flex-shrink-0" />
                      <span>{strength}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Suggestions */}
            {displaySuggestions.length === 0 ? (
              <div className="flex flex-col items-center justify-center text-center py-8">
                <Check className="w-12 h-12 text-green-400 light:text-green-500 mb-4" />
                <h4 className="text-lg font-medium text-slate-300 light:text-slate-700 mb-2">
                  {t('excellentPerformance')}
                </h4>
                <p className="text-sm text-slate-500 light:text-slate-500 max-w-md">
                  {t('noSuggestionsDesc')}
                </p>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="flex items-center gap-2">
                  <TrendingUp className="w-5 h-5 text-cyan-400 light:text-cyan-600" />
                  <span className="text-sm font-medium text-slate-300 light:text-slate-700">
                    {t('optimizationSuggestions')} ({displaySuggestions.length})
                  </span>
                </div>
                {displaySuggestions.map((suggestion) => {
                  const typeConfig = SUGGESTION_TYPE_CONFIG[suggestion.type];
                  const severityConfig = SEVERITY_CONFIG[suggestion.severity || 'medium'];
                  return (
                    <div
                      key={suggestion.id}
                      className={`p-4 rounded-lg border ${
                        suggestion.applied
                          ? 'border-green-500/30 bg-green-500/5'
                          : 'border-slate-700 light:border-slate-200 bg-slate-800/30 light:bg-slate-50'
                      }`}
                    >
                      <div className="flex items-start justify-between mb-2">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span
                            className={`px-2 py-0.5 text-xs rounded-full ${typeConfig.bgColor} ${typeConfig.color}`}
                          >
                            {t(typeConfig.labelKey)}
                          </span>
                          <span
                            className={`px-2 py-0.5 text-xs rounded-full ${severityConfig.bgColor} ${severityConfig.color}`}
                          >
                            {t('priority')}: {t(severityConfig.labelKey)}
                          </span>
                          <h4 className="text-sm font-medium text-slate-200 light:text-slate-800">
                            {suggestion.title}
                          </h4>
                        </div>
                        {suggestion.applied ? (
                          <span className="flex items-center gap-1 text-xs text-green-400 light:text-green-600">
                            <Check className="w-3 h-3" />
                            {t('applied')}
                          </span>
                        ) : (
                          <div className="flex gap-1">
                            {suggestion.originalText && suggestion.suggestedText && (
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => handleApply(suggestion)}
                                className="text-xs text-green-400 hover:text-green-300"
                              >
                                <Check className="w-3 h-3 mr-1" />
                                {t('apply')}
                              </Button>
                            )}
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleDismiss(suggestion.id)}
                              className="text-xs text-slate-400 hover:text-slate-300"
                            >
                              <X className="w-3 h-3" />
                            </Button>
                          </div>
                        )}
                      </div>

                      <p className="text-sm text-slate-400 light:text-slate-600 mb-3">
                        {suggestion.description}
                      </p>

                      {suggestion.originalText && suggestion.suggestedText && (
                        <div className="space-y-2">
                          <div className="p-2 rounded bg-red-500/10 border border-red-500/20">
                            <div className="text-xs text-red-400 light:text-red-500 mb-1">
                              {t('originalText')}
                            </div>
                            <div className="text-sm text-slate-300 light:text-slate-700 line-through opacity-60">
                              {suggestion.originalText}
                            </div>
                          </div>
                          <div className="flex justify-center">
                            <ArrowRight className="w-4 h-4 text-slate-500" />
                          </div>
                          <div className="p-2 rounded bg-green-500/10 border border-green-500/20">
                            <div className="text-xs text-green-400 light:text-green-500 mb-1">
                              {t('suggestedText')}
                            </div>
                            <div className="text-sm text-slate-300 light:text-slate-700">
                              {suggestion.suggestedText}
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
